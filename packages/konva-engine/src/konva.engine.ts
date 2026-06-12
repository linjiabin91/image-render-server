import {
    autoRegisterFonts,
    createHttpImageLoader,
    ObjectPool,
    patchCanvas,
    type Engine,
    logger,
    PerfTimer,
    type RenderOptions,
    resolveVariables
} from "@render-server/core";
import {NapiCanvasFontRegistry} from "./napi-canvas-font-registry.js";
// Konva 类型定义在 TS 6.0 下无法正确解析，运行时导入 + 类型断言绕过
import KonvaNs from 'konva';
import type {
    ImageConfig,
    KonvaLayer,
    KonvaNamespace,
    KonvaStage,
    NodeConfig,
    StageConfig,
    TextConfig,
} from './konva.types.js';
import {Canvas, loadImage} from '@napi-rs/canvas';
import {CompressionType, Transformer} from '@napi-rs/image';
import {createHash} from "node:crypto";

const Konva = KonvaNs as unknown as KonvaNamespace;

// ═══════════════════════════════════════════════════════════════════════════
// 全局 Konva 配置
// ═══════════════════════════════════════════════════════════════════════════

Konva.autoDrawEnabled = false;

// ═══════════════════════════════════════════════════════════════════════════
// 字体管理
// ═══════════════════════════════════════════════════════════════════════════

autoRegisterFonts(new NapiCanvasFontRegistry(), import.meta.url);

/** 拦截 Konva 内部 canvas 创建，返回 @napi-rs/canvas 修补实例 */
Konva.Util.createCanvasElement = () =>
    patchCanvas(new Canvas(1, 1)) as unknown as HTMLCanvasElement;

// ═══════════════════════════════════════════════════════════════════════════
// Mock 容器对象 — 满足 Konva Stage container 参数
// ═══════════════════════════════════════════════════════════════════════════

const createMockContainer = (width: number, height: number): Record<string, unknown> => ({
    clientWidth: width,
    clientHeight: height,
    style: {},
    appendChild: () => {},
    removeChild: () => {},
    insertBefore: () => {},
    getBoundingClientRect: () => ({
        width, height, top: 0, left: 0, right: width, bottom: height, x: 0, y: 0,
        toJSON() { return this; },
    }),
    addEventListener: () => {},
    removeEventListener: () => {},
    querySelectorAll: () => [],
    getAttribute: () => null,
    setAttribute: () => {},
    removeAttribute: () => {},
});

// ═══════════════════════════════════════════════════════════════════════════
// 类型定义
// ═══════════════════════════════════════════════════════════════════════════

/** Konva 节点 — 递归结构，兼容 tag 和 className 两种属性名 */
export interface KonvaNode {
    /** leafer 格式的节点类型标识 */
    tag?: string;
    /** fabric 格式的节点类型标识（如 "Text"、"Image"、"Group"、"Layer"） */
    className?: string;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    text?: string;
    fontSize?: number;
    fontFamily?: string;
    fill?: string | {type: string; url: string};
    /** leafer 格式的图片 URL */
    url?: string;
    /** fabric 格式的图片 URL（className="Image" 时） */
    image?: string;
    children?: KonvaNode[];
    [key: string]: unknown;
}

/** 模板 JSON — 与 LeaferTemplateJson 相同的场景结构 */
export interface KonvaTemplateJson {
    width: number;
    height: number;
    tag?: 'Leafer';
    children: KonvaNode[];
    [key: string]: unknown;
}

/**
 * 获取节点类型 — 兼容 tag 和 className 两种属性名
 *
 * @param node - 模板节点
 * @returns 节点类型字符串（小写）
 */
function getNodeType(node: KonvaNode): string {
    const raw = (node.tag || node.className || '') as string;
    return raw.toLowerCase();
}

/**
 * 获取图片 URL — 兼容 image、url、fill.url 三种来源
 *
 * @param node - 模板节点
 * @returns 图片 URL 或 undefined
 */
function getImageUrl(node: KonvaNode): string | undefined {
    if (node.image && typeof node.image === 'string') return node.image as string;
    if (node.url) return node.url;
    if (node.fill && typeof node.fill === 'object') return (node.fill as Record<string, string>).url;
    return undefined;
}

/** 池条目 */
interface PoolEntry {
    stage: KonvaStage;
    /** Konva 内部的实际 canvas（已修补，@napi-rs/canvas 实例） */
    canvas: Canvas;
    layer: KonvaLayer;
}

// ═══════════════════════════════════════════════════════════════════════════
// 引擎
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Konva 渲染引擎 — 纯渲染实现
 *
 * 在 Piscina worker 线程中调用，每个 Worker 持有长期复用的 Konva 实例。
 * 模板格式与 Leafer 引擎兼容（LeaferTemplateJson）。
 */
export class KonvaEngine implements Engine {
    /** LRU 池：键为模板 MD5，值按最近使用排序 */
    readonly #pool = new ObjectPool<PoolEntry>({
        max: 10,
        onEvict: (entry) => {
            this.#cacheKeyMap.delete(entry.stage);
            entry.stage.destroy();
        },
    });
    #initialized = false;
    /** 记录每个 Stage 的 cacheKey，用于缓存命中判断 */
    #cacheKeyMap = new WeakMap<KonvaStage, string>();
    /** 图片加载器（三级缓存：LRU → 磁盘 → HTTP） */
    #imageLoader = createHttpImageLoader(async (buf) => loadImage(buf));

    /**
     * 初始化引擎
     */
    async init(): Promise<void> {
        this.#initialized = true;
    }

    /**
     * 执行渲染
     *
     * @param params - 渲染参数
     *   - options: 渲染配置
     *   - templateJson: Konva JSON 结构（LeaferTemplateJson 格式）
     *   - variables: 变量替换映射
     * @returns 渲染结果图片的 Buffer
     */
    async render(params: {
        options: RenderOptions;
        templateJson: KonvaTemplateJson;
        variables: Record<string, string>;
    }): Promise<Buffer> {
        if (!this.#initialized) {
            throw new Error("KonvaEngine not initialized, call init() first");
        }

        const {width, height, format, pixelRatio = 1, compressLevel = 0} = params.options;
        const pw = Math.ceil(width * pixelRatio);
        const ph = Math.ceil(height * pixelRatio);
        const json = params.templateJson;
        const perf = new PerfTimer("render");

        // (a) 变量替换
        const resolvedJson = resolveVariables(json, params.variables) as KonvaTemplateJson;
        perf.mark("resolve");

        // (b) 判断缓存命中
        const cacheKey = createHash("md5").update(JSON.stringify({
            options: params.options,
            templateJson: json,
        })).digest("hex");

        const entry = this.#pool.acquire(cacheKey, () => {
            const mockContainer = createMockContainer(pw, ph);
            const stage = new Konva.Stage({
                container: mockContainer,
                width: pw,
                height: ph,
            } as StageConfig) as unknown as KonvaStage;
            const layer = new Konva.Layer() as unknown as KonvaLayer;
            (stage as unknown as { add(l: KonvaLayer): void }).add(layer);
            const canvas = (layer.canvas as unknown as Record<string, Canvas>)._canvas;
            return {stage, canvas, layer};
        });
        const prevKey = this.#cacheKeyMap.get(entry.stage);
        const isCacheHit = prevKey === cacheKey && (entry.layer.children?.length ?? 0) > 0;

        if (isCacheHit) {
            // HIT：增量更新
            await this.#smartUpdate(entry.layer, resolvedJson);
            perf.mark("smartUpdate");
        } else {
            // MISS：预加载图片 + 全量重建
            await this.#preloadImages(resolvedJson);
            perf.mark("preload");
            this.#rebuildStage(entry.layer, resolvedJson);
            this.#cacheKeyMap.set(entry.stage, cacheKey);
            perf.mark("build");
        }

        // (c) 触发 Konva 渲染
        entry.layer.draw();
        perf.mark("konva");

        // (d) 编码输出
        const ctx = entry.canvas.getContext?.('2d') as unknown as CanvasRenderingContext2D | undefined;
        if (!ctx) {
            throw new Error("Failed to get 2D context from canvas");
        }

        let result: Buffer;
        if (format === "png") {
            // PNG：走 getImageData + @napi-rs/image 以获得压缩等级控制
            const imageData = ctx.getImageData(0, 0, pw, ph);
            perf.mark("readPixels");
            const tx = Transformer.fromRgbaPixels(imageData.data, pw, ph);
            result = tx.pngSync({
                compressionType: compressLevel === 0
                    ? CompressionType.Default
                    : compressLevel <= 4
                        ? CompressionType.Best
                        : CompressionType.Fast,
            });
            perf.mark("encode");
        } else {
            // 其他格式：@napi-rs/canvas 原生 toBuffer
            const fmt = format === 'jpg' ? 'jpeg' : format;
            const mime: 'image/jpeg' | 'image/webp' = fmt === 'jpeg' ? 'image/jpeg' : 'image/webp';
            result = entry.canvas.toBuffer(mime) as Buffer;
            perf.mark("encode");
        }

        logger.info({steps: perf.steps(), format, size: `${pw}x${ph}`}, "render");
        return result;
    }

    /**
     * 销毁引擎，释放所有 Konva 实例资源
     */
    destroy(): void {
        this.#pool.clear();
        this.#imageLoader.clear();
        this.#initialized = false;
    }

    // ── 池管理 ──────────────────────────────────────────────────────────

    // ── 全量重建 ────────────────────────────────────────────────────────

    /**
     * 全量重建 Stage — 清空 Layer 并从 JSON 重新构建节点树
     *
     * @param layer - Konva Layer
     * @param json - 变量替换后的模板 JSON
     */
    #rebuildStage(layer: KonvaLayer, json: KonvaTemplateJson): void {
        (layer as unknown as { destroyChildren(): void }).destroyChildren();
        if (json.children) {
            for (const child of json.children) {
                const node = this.#buildNode(child);
                if (node) {
                    (layer as unknown as { add(n: unknown): void }).add(node);
                }
            }
        }
    }

    /**
     * 递归构建 Konva 节点
     *
     * 支持 tag / className 两种属性名：
     * - "Text" → Konva.Text
     * - "Image" → Konva.Image（image/url/fill.url 三种 URL 来源）
     * - "Group" / "Layer" → Konva.Group（容器，递归 children）
     *
     * @param node - 模板节点
     * @returns Konva Node 或 null
     */
    #buildNode(node: KonvaNode): unknown {
        const type = getNodeType(node).toLowerCase();
        if (type === "text") {
            return this.#buildTextNode(node);
        }
        if (type === "image") {
            return this.#buildImageNode(node);
        }
        if (type === "group" || type === "layer") {
            const group = new Konva.Group({
                x: node.x,
                y: node.y,
                width: node.width,
                height: node.height,
            } as NodeConfig);
            if (node.children) {
                for (const child of node.children) {
                    const childNode = this.#buildNode(child);
                    if (childNode) {
                        (group as unknown as { add(n: unknown): void }).add(childNode);
                    }
                }
            }
            return group;
        }
        return null;
    }

    /**
     * 构建 Konva.Text 节点
     *
     * @param node - Text 模板节点
     * @returns Konva.Text 实例
     */
    #buildTextNode(node: KonvaNode): unknown {
        const attrs: Record<string, unknown> = {
            x: node.x ?? 0,
            y: node.y ?? 0,
            width: node.width,
            height: node.height,
            text: node.text ?? '',
            fontSize: node.fontSize ?? 16,
            fontFamily: node.fontFamily ?? 'sans-serif',
            fill: typeof node.fill === 'string' ? node.fill : '#333',
        };
        // 过滤 undefined
        for (const k of Object.keys(attrs)) {
            if (attrs[k] === undefined) delete attrs[k];
        }
        return new Konva.Text(attrs as TextConfig);
    }

    /**
     * 构建 Konva.Image 节点
     *
     * 图片 URL 来源优先级：node.image > node.url > node.fill.url
     *
     * @param node - Image 模板节点
     * @returns Konva.Image 实例
     */
    #buildImageNode(node: KonvaNode): unknown {
        const imgUrl = getImageUrl(node);
        if (!imgUrl) return null;

        const img = this.#imageLoader.getCached(imgUrl);
        if (!img) {
            logger.warn({url: imgUrl.slice(0, 80)}, "image not preloaded for build");
            return null;
        }

        const attrs: Record<string, unknown> = {
            x: node.x ?? 0,
            y: node.y ?? 0,
            width: node.width,
            height: node.height,
            image: img,
        };
        for (const k of Object.keys(attrs)) {
            if (attrs[k] === undefined) delete attrs[k];
        }
        return new Konva.Image(attrs as ImageConfig);
    }

    // ── 图片预加载 ──────────────────────────────────────────────────────

    /**
     * 预加载 JSON 中所有图片 URL
     *
     * @param json - 模板 JSON
     */
    async #preloadImages(json: KonvaTemplateJson): Promise<void> {
        const urls = collectImageUrls(json);
        if (urls.length === 0) return;
        await this.#imageLoader.preload(urls);
    }

    // ── 智能更新 ────────────────────────────────────────────────────────

    /**
     * 增量更新 Layer 节点 — 仅更新变化的 text/url 属性
     *
     * 按数组索引匹配，前置 cache hit 保证结构一致。
     *
     * @param layer - Konva Layer
     * @param resolvedJson - 变量替换后的模板 JSON
     */
    async #smartUpdate(layer: KonvaLayer, resolvedJson: KonvaTemplateJson): Promise<void> {
        const existing = layer.children ?? [];
        const newChildren = resolvedJson.children ?? [];
        await this.#smartUpdateChildren(existing as unknown[], newChildren);
    }

    /**
     * 递归更新子节点列表
     *
     * @param existing - 现有 Konva Node 数组
     * @param newChildren - 新模板节点数组
     */
    async #smartUpdateChildren(existing: unknown[], newChildren: KonvaNode[]): Promise<void> {
        const len = Math.min(existing.length, newChildren.length);
        for (let i = 0; i < len; i++) {
            const target = existing[i] as Record<string, unknown>;
            const node = newChildren[i];

            const nodeType = getNodeType(node).toLowerCase();
            if (nodeType === "text" && (target.getClassName as () => string)?.() === "Text") {
                if ((target.text as () => string)?.() !== node.text) {
                    (target.text as (v: string) => void)(node.text ?? '');
                }
            } else if (nodeType === "image" && (target.getClassName as () => string)?.() === "Image") {
                const newUrl = getImageUrl(node);
                const currentUrl = target.__url as string | undefined;
                if (newUrl !== undefined && newUrl !== currentUrl) {
                    // 加载新图片
                    const img = await this.#imageLoader.load(newUrl);
                    if (img) {
                        (target.image as (v: unknown) => void)(img);
                        target.__url = newUrl;
                    }
                }
            }

            // 递归处理 Group 子节点
            const targetChildren = target.children as unknown[] | undefined;
            const nodeChildren = node.children;
            if (targetChildren && targetChildren.length > 0 && nodeChildren && nodeChildren.length > 0) {
                await this.#smartUpdateChildren(targetChildren, nodeChildren);
            }
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// 工具函数
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 收集 JSON 中所有图片 URL
 *
 * @param json - 模板 JSON
 * @returns 去重后的 URL 数组
 */
function collectImageUrls(json: KonvaTemplateJson): string[] {
    const urls = new Set<string>();

    function walk(childs: KonvaNode[]): void {
        if (!childs || !childs.length) return;
        for (const child of childs) {
            const type = getNodeType(child).toLowerCase();
            if (type === "image") {
                const imgUrl = getImageUrl(child);
                if (imgUrl) urls.add(imgUrl);
            }
            if (child.fill && typeof child.fill === 'object' && (child.fill as Record<string, string>).url) {
                urls.add((child.fill as Record<string, string>).url);
            }
            if (child.children) {
                walk(child.children);
            }
        }
    }

    walk(json.children);
    return [...urls];
}
