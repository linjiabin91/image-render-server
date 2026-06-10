/**
 * Playwright 无头浏览器渲染引擎
 *
 * 通过 Playwright 控制 Chromium 无头浏览器，加载 HTML 页面、
 * 调用页面的 draw(json) 方法、截图输出。
 * 每个 Worker 持有浏览器连接和页面池，页面按模板 MD5 复用。
 */
import {type Browser, type BrowserContext, type Page} from "playwright";
import {type Engine, logger, type RenderOptions, PerfTimer} from "@render-server/core";
import {createHash} from "node:crypto";
import {fileURLToPath} from "node:url";
import {dirname, join} from "node:path";

// ── 常量 ──────────────────────────────────────────────────────────────────

/** 页面池最大容量 */
const POOL_MAX = 10;

/** 页面最大闲置时间（毫秒），超过则关闭释放 */
const PAGE_IDLE_TIMEOUT = 1000 * 60 * 5;

/** 等待 draw 完成超时（毫秒） */
const DRAW_TIMEOUT = 30_000;

/** 默认引擎标识 */
const DEFAULT_ENGINE = "leafer";

/** 默认版本号 */
const DEFAULT_VERSION = "1";

// ── 类型 ──────────────────────────────────────────────────────────────────

/** 池中页面状态 */
interface PoolEntry {
  /** Playwright Page 实例 */
  page: Page;
  /** 是否被任务锁定 */
  locked: boolean;
  /** 最近一次释放时间戳 */
  lastReleased: number;
}

// ── 引擎 ──────────────────────────────────────────────────────────────────

export class PlaywrightEngine implements Engine {
  /** Playwright 浏览器实例 */
  #browser!: Browser;
  /** 浏览器上下文（单 Worker 一个 context） */
  #context!: BrowserContext;
  /** 页面池：key 为模板 MD5 */
  #pagePool = new Map<string, PoolEntry>();
  #initialized = false;
  /** 页面文件所在目录 */
  #pagesDir!: string;

  /**
   * @param browser - 已连接的 Playwright Browser 实例
   */
  constructor(browser: Browser) {
    this.#browser = browser;
  }

  /**
   * 初始化引擎，创建浏览器上下文、解析页面目录
   */
  async init(): Promise<void> {
    this.#context = await this.#browser.newContext({
      viewport: null, // 由页面内容决定视口
      deviceScaleFactor: 1,
    });

    // 解析 pages 目录路径
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    this.#pagesDir = join(__dirname, "pages");

    this.#initialized = true;
  }

  /**
   * 执行渲染
   *
   * 1. 变量替换
   * 2. 计算 pool key（模板 MD5）
   * 3. 获取/创建页面
   * 4. 导航到 HTML 页面
   * 5. 调用 draw(json)
   * 6. 截图
   * 7. 释放页面
   *
   * @param params - 渲染参数
   * @returns 渲染结果图片的 Buffer
   */
  async render(params: {
    options: RenderOptions;
    templateJson: Record<string, unknown>;
    variables: Record<string, string>;
  }): Promise<Buffer> {
    if (!this.#initialized) {
      throw new Error("PlaywrightEngine not initialized, call init() first");
    }

    const perf = new PerfTimer("render");

    // (1) 变量替换
    const resolvedJson = this.#resolveVariables(params.templateJson, params.variables);
    perf.mark("resolve");

    // (2) 计算 pool key
    const key = createHash("md5")
      .update(JSON.stringify({options: params.options, templateJson: params.templateJson}))
      .digest("hex");

    // (3) 获取页面（锁定）
    const entry = await this.#acquirePage(key);
    perf.mark("acquirePage");

    try {
      // (4) 计算页面路径
      const engine = params.options.engine ?? DEFAULT_ENGINE;
      const version = params.options.version ?? DEFAULT_VERSION;
      const pageFileName = `${engine}_${version}.html`;
      const pagePath = join(this.#pagesDir, pageFileName);
      const pageUrl = `file://${pagePath}`;

      // (5) 导航到页面
      await entry.page.goto(pageUrl, {waitUntil: "networkidle", timeout: DRAW_TIMEOUT});
      perf.mark("goto");

      // (6) 调用 draw(json)
      await entry.page.evaluate(
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
        (json: Record<string, unknown>) => (window as unknown as Record<string, unknown>).draw(json),
        resolvedJson,
      );
      perf.mark("draw");

      // (7) 截图
      const {format, quantity, pixelRatio = 1} = params.options;
      const {width, height} = params.options;
      const pw = Math.ceil(width * pixelRatio);
      const ph = Math.ceil(height * pixelRatio);

      const screenshotOptions: Record<string, unknown> = {
        type: format === "jpeg" ? "jpeg" : format,
        clip: {x: 0, y: 0, width: pw, height: ph},
      };

      // quality 仅对 jpeg/webp 有效
      if (format === "jpeg" || format === "jpg" || format === "webp") {
        screenshotOptions.quality = quantity;
      }

      const buffer = await entry.page.screenshot(screenshotOptions as Parameters<Page["screenshot"]>[0]);
      perf.mark("screenshot");

      logger.info({steps: perf.steps(), tree: perf.snapshot(), format, size: `${pw}x${ph}`}, "render");
      return buffer;
    } finally {
      // (8) 释放页面
      entry.locked = false;
      entry.lastReleased = Date.now();
    }
  }

  /**
   * 销毁引擎，关闭所有页面和浏览器上下文
   */
  destroy(): void {
    for (const [, entry] of this.#pagePool) {
      entry.page.close().catch(() => { /* 忽略关闭错误 */ });
    }
    this.#pagePool.clear();
    this.#context?.close().catch(() => { /* 忽略关闭错误 */ });
    this.#initialized = false;
  }

  // ── 私有方法 ────────────────────────────────────────────────────────────

  /**
   * 变量替换：将 JSON 字符串中的 {{key}} 替换为变量值
   *
   * @param json - 模板 JSON
   * @param variables - 变量映射
   * @returns 替换后的 JSON
   */
  #resolveVariables(
    json: Record<string, unknown>,
    variables: Record<string, string>,
  ): Record<string, unknown> {
    const str = JSON.stringify(json);
    const resolved = str.replace(/\{\{(\w+)}}/g, (_, key: string) => variables[key] ?? `{{${key}}}`);
    return JSON.parse(resolved) as Record<string, unknown>;
  }

  /**
   * 从池中获取一个可用页面，或创建新页面
   *
   * 分配策略：
   * - 池中有未锁定页面且 key 匹配 → 返回该页面
   * - 池中 key 匹配但锁定 → 轮询等待（Piscina Worker 串行执行时不会发生）
   * - 无匹配且未超限 → 创建新页面
   * - 超限 → 淘汰最久未使用的页面
   *
   * @param key - 模板 MD5
   * @returns 池条目（页面已锁定）
   */
  async #acquirePage(key: string): Promise<PoolEntry> {
    // 1. 清理过期页面（保留当前 key 的条目，避免正在等待的页面被误删）
    this.#evictIdlePages(key);

    // 2. 查找匹配且未锁定的页面
    const existing = this.#pagePool.get(key);
    if (existing && !existing.locked) {
      existing.locked = true;
      return existing;
    }

    // 3. key 匹配但被锁定（理论上 Piscina 串行不会发生）
    if (existing?.locked) {
      // 轮询等待锁释放
      return await this.#waitForPage(key);
    }

    // 4. 页面池超限，淘汰最早未锁定的
    if (this.#pagePool.size >= POOL_MAX) {
      this.#evictOne();
    }

    // 5. 创建新页面
    const page = await this.#context.newPage();
    const entry: PoolEntry = {
      page,
      locked: true,
      lastReleased: Date.now(),
    };
    this.#pagePool.set(key, entry);
    return entry;
  }

  /**
   * 轮询等待指定 key 的页面被释放
   *
   * @param key - 模板 MD5
   * @param interval - 轮询间隔（毫秒）
   * @param timeout - 超时（毫秒）
   * @returns 锁定的页面条目
   */
  async #waitForPage(
    key: string,
    interval = 50,
    timeout = 10_000,
  ): Promise<PoolEntry> {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const entry = this.#pagePool.get(key);
      if (entry && !entry.locked) {
        entry.locked = true;
        return entry;
      }
      await new Promise((resolve) => setTimeout(resolve, interval));
    }
    throw new Error(`Timeout waiting for page (key=${key.slice(0, 8)}...)`);
  }

  /**
   * 清理闲置过久的页面
   *
   * @param preserveKey - 保留的 key（不淘汰该模板的页面）
   */
  #evictIdlePages(preserveKey: string): void {
    const now = Date.now();
    for (const [key, entry] of this.#pagePool) {
      if (key === preserveKey) continue;
      if (!entry.locked && now - entry.lastReleased > PAGE_IDLE_TIMEOUT) {
        entry.page.close().catch(() => { /* 忽略关闭错误 */ });
        this.#pagePool.delete(key);
      }
    }
  }

  /**
   * 淘汰一个最早未锁定的页面
   */
  #evictOne(): void {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [key, entry] of this.#pagePool) {
      if (entry.locked) continue;
      if (entry.lastReleased < oldestTime) {
        oldestTime = entry.lastReleased;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      const entry = this.#pagePool.get(oldestKey)!;
      entry.page.close().catch(() => { /* 忽略关闭错误 */ });
      this.#pagePool.delete(oldestKey);
    }
  }
}

export type {PoolEntry};
