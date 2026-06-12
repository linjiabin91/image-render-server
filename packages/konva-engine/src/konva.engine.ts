import {
    autoRegisterFonts,
    createHttpImageLoader,
    encodePngRgba,
    type Engine,
    logger,
    ObjectPool,
    PerfTimer,
    type RenderOptions,
    resolveVariables
} from "@render-server/core";
import {SkiaFontRegistry} from "./skia-font-registry.js";
// 1. 先执行，模拟 Node 环境
import Konva from 'konva'
import 'konva/skia-backend';
import {Canvas, loadImage} from 'skia-canvas';
import {createHash} from "node:crypto";

// ═══════════════════════════════════════════════════════════════════════════
// 字体管理
// ═══════════════════════════════════════════════════════════════════════════

autoRegisterFonts(new SkiaFontRegistry(), import.meta.url);
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
    src?: string;
    /** fabric 格式的图片 URL（className="Image" 时） */
    image?: string;
    children?: KonvaNode[];
    attrs?: Record<string, unknown>
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
    const raw = (node.className || '') as string;
    return raw.toLowerCase();
}

/**
 * 获取图片 URL — 兼容 image、url、fill.url 三种来源
 *
 * @param node - 模板节点
 * @returns 图片 URL 或 undefined
 */
function getImageUrl(node: KonvaNode): string | undefined {
    if (node.attrs && node.attrs.src) {
        return node.attrs.src as string;
    }
    return undefined;
}

/** 池条目 */
interface PoolEntry {
    stage: Konva.Stage;
    /** Konva 内部的实际 canvas（skia-canvas 实例） */
    canvas: HTMLCanvasElement;
    layer: Konva.Layer;
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
    #cacheKeyMap = new WeakMap<Konva.Stage, string>();
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

        const {width, height, format, pixelRatio = 1, compressLevel = 0, quantity = 92} = params.options;
        const json = params.templateJson;
        const perf = new PerfTimer("render");

        // (a) 变量替换
        const resolvedJson = resolveVariables(json, params.variables) as KonvaTemplateJson;
        const konvaNode = resolvedJson.children[0];
        const childs = konvaNode.children;
        perf.mark("resolve");

        // (b) 判断缓存命中
        const cacheKey = createHash("md5").update(JSON.stringify({
            options: params.options,
            templateJson: json,
        })).digest("hex");

        const entry = this.#pool.acquire(cacheKey, () => {
            const stage = new Konva.Stage({
                width: width,
                height: height,
                pixelRatio: pixelRatio
            });
            const layer = new Konva.Layer();
            stage.add(layer);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any — Konva 内部属性
            const canvas = (layer.canvas as any)._canvas;
            return {stage, canvas, layer};
        });

        // MISS：预加载图片 + 全量重建
        await this.#preloadImages(resolvedJson);
        entry.layer.destroyChildren();
        childs?.forEach((child) => {
            entry.layer.add(Konva.Node.create(child));
        })
        const images = entry.stage.find('Image') as Konva.Image[];
        for (const imgNode of images) {
            const src = imgNode.attrs.src;
            if (!src) continue;
            // skia-canvas 加载远程图片
            const img = await this.#imageLoader.getCached(src);
            // 给 Image 节点绑定图片实例
            imgNode.image(img as any);
        }
        this.#cacheKeyMap.set(entry.stage, cacheKey);
        perf.mark("build");

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
            const imageData = ctx.getImageData(0, 0, width, height);
            perf.mark("readPixels");
            result = encodePngRgba(imageData.data, width, height, compressLevel);
            perf.mark("encode");
        } else {
            const skiaCanvas = entry.canvas as unknown as Canvas;
            result = skiaCanvas.toBufferSync(format, {quality: quantity/100})
        }

        logger.info({steps: perf.steps(), format, size: `${width}x${height}`}, "render");
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
            if (child.children) {
                walk(child.children);
            }
        }
    }

    walk(json.children);
    return [...urls];
}
