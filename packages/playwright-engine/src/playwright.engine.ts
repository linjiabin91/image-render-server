/**
 * Playwright 无头浏览器渲染引擎
 *
 * 通过 Playwright 控制 Chromium 无头浏览器，加载 HTML 页面、
 * 调用页面的 draw(json) 方法、截图输出。
 * 每个 Worker 持有浏览器连接和页面池，页面按模板 MD5 复用。
 */
import {type Browser, type BrowserContext, type Page, type PageScreenshotOptions} from "playwright-core";
import {type Engine, logger, type RenderOptions, PerfTimer} from "@render-server/core";
import {CompressionType, Transformer} from '@napi-rs/image';
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

/** Playwright 支持的截图格式（webp 不支持，降级为 png） */
type ScreenshotType = "png" | "jpeg";

/** 默认引擎标识 */
const DEFAULT_ENGINE = "leafer";

/** 默认版本号 */
const DEFAULT_VERSION = "1";

// ── 内部类型 ──────────────────────────────────────────────────────────────

/** 池中页面状态 */
interface PoolEntry {
  page: Page;
  locked: boolean;
  lastReleased: number;
}

// ── 工具函数 ──────────────────────────────────────────────────────────────

/**
 * 将 ImageFormat 标准化为 Playwright 接受的截图类型
 *
 * Playwright page.screenshot() 的 type 只接受 "png" | "jpeg"，
 * 不接受 "jpg" 或 "webp"。此处统一映射，webp 降级为 png。
 *
 * @param format - 输入格式
 * @returns Playwright 兼容的截图类型
 */
function toScreenshotType(format: string): ScreenshotType {
  if (format === "jpg") return "jpeg";
  if (format === "jpeg") return "jpeg";
  return "png";
}

// ── 引擎 ──────────────────────────────────────────────────────────────────

export class PlaywrightEngine implements Engine {
  #browser!: Browser;
  #context!: BrowserContext;
  #pagePool = new Map<string, PoolEntry>();
  #initialized = false;
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
      viewport: {width: 4096, height: 4096},
      deviceScaleFactor: 1,
    });

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
   * 4. 导航到 HTML 页面（如 URL 不同）
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
      // (4) 计算页面路径: {engine}_{version}.html，version 为空时直接 {engine}.html
      const engine = params.options.engine ?? DEFAULT_ENGINE;
      const version = params.options.version ?? DEFAULT_VERSION;
      const pageFileName = version ? `${engine}_${version}.html` : `${engine}.html`;
      const pagePath = join(this.#pagesDir, pageFileName);
      const pageUrl = `file://${pagePath}`;

      // (5) 导航：仅在 URL 不同时 reload，复用已加载页面
      if (entry.page.url() !== pageUrl) {
        await entry.page.goto(pageUrl, {waitUntil: "load", timeout: DRAW_TIMEOUT});
      }
      perf.mark("goto");

      // (6) 调用 draw({options, templateJson, cacheKey})
      //     模板 JSON 已完成变量替换；cacheKey 用于页面内增量更新判断
      //     draw 返回 {pixels, width, height} 或 null（跨域 canvas 退回到截图）
      const pixelData = await entry.page.evaluate((data) => {
        return (window as unknown as Record<string, (data: unknown) => Promise<unknown>>).draw(data);
      }, {options: params.options, templateJson: resolvedJson, cacheKey: key});
      // draw 完成后再等待网络空闲，确保远程图片加载完毕
      await entry.page.waitForLoadState("networkidle", {timeout: DRAW_TIMEOUT});
      perf.mark("draw");

      // (7) 编码输出
      const {format, quantity, pixelRatio = 1, width, height, compressLevel = 0} = params.options;
      const pw = Math.ceil(width * pixelRatio);
      const ph = Math.ceil(height * pixelRatio);

      let result: Buffer;
      if (pixelData && format === "png") {
        // PNG：用 raw buffer + @napi-rs/image 精确控制压缩比
        const pd = pixelData as {pixels: Uint8Array; width: number; height: number};
        const pixels = Buffer.from(pd.pixels);
        const tx = Transformer.fromRgbaPixels(pixels, pw, ph);
        result = tx.pngSync({
          compressionType: compressLevel === 0 ? CompressionType.Default
            : compressLevel === 1 ? CompressionType.Best
            : CompressionType.Fast,
        });
      } else {
        // JPEG 或跨域 canvas 退回到 Playwright 截图
        const screenshotType = toScreenshotType(format);
        const opts: PageScreenshotOptions = {
          type: screenshotType,
          clip: {x: 0, y: 0, width: pw, height: ph},
        };
        if (screenshotType === "jpeg") {
          opts.quality = quantity;
        }
        result = await entry.page.screenshot(opts);
      }
      perf.mark("screenshot");

      logger.info({steps: perf.steps(), format, size: `${pw}x${ph}`}, "render");
      return result;
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
      entry.page.close().catch(() => { /* ignore */ });
    }
    this.#pagePool.clear();
    this.#context?.close().catch(() => { /* ignore */ });
    this.#initialized = false;
  }

  // ── 私有方法 ────────────────────────────────────────────────────────────

  /**
   * 变量替换：将 JSON 字符串中的 {{key}} 替换为变量值
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
   * - 池中 key 匹配但锁定 → 轮询等待（Piscina Worker 串行执行时通常不会发生）
   * - 无匹配且未超限 → 创建新页面
   * - 超限且存在未锁页面 → 淘汰最早未锁定的
   * - 超限且所有页面锁定 → 仍创建新页面（池临时超出上限，后续清理）
   *
   * @param key - 模板 MD5
   * @returns 池条目（页面已锁定）
   */
  async #acquirePage(key: string): Promise<PoolEntry> {
    this.#evictIdlePages(key);

    const existing = this.#pagePool.get(key);
    if (existing && !existing.locked) {
      if (existing.page.isClosed()) {
        this.#pagePool.delete(key);
      } else {
        existing.locked = true;
        return existing;
      }
    }

    if (existing?.locked) {
      return await this.#waitForPage(key);
    }

    if (this.#pagePool.size >= POOL_MAX) {
      this.#evictOne();
    }

    const page = await this.#context.newPage();

    // 转发页面 console 日志到引擎日志（用于调试）
    page.on("console", (msg) => {
      logger.info({page: key.slice(0, 8), type: msg.type(), text: msg.text()}, "[page]");
    });

    // 注册页面崩溃和错误监听，自动从池中移除已崩溃页面
    page.on("crash", () => {
      logger.warn({key: key.slice(0, 8)}, "page crashed, removing from pool");
      this.#pagePool.delete(key);
    });
    page.on("pageerror", (err: Error) => {
      logger.warn({err, key: key.slice(0, 8)}, "page error");
    });

    const entry: PoolEntry = {page, locked: true, lastReleased: Date.now()};
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
        entry.page.close().catch(() => { /* ignore */ });
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
      entry.page.close().catch(() => { /* ignore */ });
      this.#pagePool.delete(oldestKey);
    }
  }
}
