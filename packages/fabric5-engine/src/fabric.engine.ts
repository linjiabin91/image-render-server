import {
    autoRegisterFonts,
    createHttpImageLoader,
    encodePngRgba,
    normalizeImageOptions,
    ObjectPool,
    patchCanvas,
    collectImageUrls,
    type Engine,
    logger,
    PerfTimer,
    type RenderOptions,
    resolveVariables
} from "@render-server/core";
import type {FabricObject, FabricTemplateJson, FabricObjectLike, ImageLike} from "@render-server/core";
import {Fabric5SkiaFontRegistry} from "./fabric5-skia-font-registry.js";
import {Canvas, loadImage} from 'skia-canvas';
import {fabric} from 'fabric';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';

import {tmpdir} from 'node:os';

// ═══════════════════════════════════════════════════════════════════════════
// 字体管理
// ═══════════════════════════════════════════════════════════════════════════

autoRegisterFonts(new Fabric5SkiaFontRegistry(), import.meta.url);

// ═══════════════════════════════════════════════════════════════════════════
// Skia Canvas 修补 — 补齐 Fabric 需要的 DOM 方法
// ═══════════════════════════════════════════════════════════════════════════

fabric.util.createCanvasElement = () => patchCanvas(new Canvas(1, 1)) as unknown as HTMLCanvasElement;

// ── Font weight 兼容 patch ────────────────────────────────────────────────
//
// skia-canvas 的 CSS font 匹配比浏览器严格，fontWeight 不匹配时会回退到
// 系统字体而不是自动合成（faux bold）。此处去掉 fontWeight/fontStyle，
// 让 Skia 用分组注册的默认权重匹配，避免因权重不匹配导致回退。
// 注意：若日后需支持 fontWeight 切换变体，可删除此 patch。

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(fabric.Text.prototype as any)._getFontString = function (this: Record<string, any>) {
    return this.fontSize + 'px "' + this.fontFamily + '"';
};

// ═══════════════════════════════════════════════════════════════════════════
// 图片加载失败追踪
// ═══════════════════════════════════════════════════════════════════════════

let _failedImageUrls: Set<string>;
const resetFailedImages = () => {
    _failedImageUrls = new Set<string>();
};
resetFailedImages();

// ═══════════════════════════════════════════════════════════════════════════
// 图片加载器（三级缓存：LRU → 磁盘 → HTTP）
// ═══════════════════════════════════════════════════════════════════════════

const imageLoader = createHttpImageLoader(async (buf) => loadImage(buf), {
    cacheDir: resolve(tmpdir(), 'image-cache'),
});

// ═══════════════════════════════════════════════════════════════════════════
// CSS 约束修正
// ═══════════════════════════════════════════════════════════════════════════


// ═══════════════════════════════════════════════════════════════════════════
// Fabric 拦截器
// ═══════════════════════════════════════════════════════════════════════════

fabric.Image.fromURL = ((url: string, callback: (img?: fabric.Image) => void, imgOptions?: Record<string, unknown>) => {
    const cachedImg = imageLoader.getCached(url);
    if (cachedImg) {
        normalizeImageOptions(imgOptions, cachedImg as ImageLike);
        callback(new fabric.Image(cachedImg as unknown as HTMLImageElement, imgOptions));
        return;
    }

    imageLoader.load(url).then((imgElement: unknown) => {
        try {
            normalizeImageOptions(imgOptions, imgElement as ImageLike);
            callback(new fabric.Image(imgElement as unknown as HTMLImageElement, imgOptions));
        } catch {
            callback();
        }
    }).catch(() => {
        callback();
    });
}) as unknown as typeof fabric.Image.fromURL;

fabric.util.loadImage = ((url: string, callback: (img: HTMLImageElement | null, isError: boolean) => void) => {
    imageLoader.load(url)
        .then((image) => callback(image as HTMLImageElement, false))
        .catch(() => callback(null, true));
    return undefined;
}) as unknown as typeof fabric.util.loadImage;

// Fabric 5 的 loadFromJSON 走 fabric.Image.fromObject，需拦截做 CSS 修正
const ImageKlass = fabric.Image as unknown as Record<string, unknown>;
ImageKlass.fromObject = function (_object: Record<string, unknown>, callback: (img: fabric.Image | null, isError: boolean) => void) {
    const object = fabric.util.object.clone(_object);
    imageLoader.load(object.src).then((img: unknown) => {
        if (!img) {
            _failedImageUrls.add(object.src);
            callback(null, true);
            return;
        }
        normalizeImageOptions(object, img as ImageLike);
        const ImageProto = fabric.Image.prototype as unknown as Record<string, unknown>;
        const initFilters = ImageProto._initFilters as (this: unknown, filters: unknown[], cb: (f: unknown[]) => void) => void;
        initFilters.call(object, object.filters || [], (filters: unknown[]) => {
            object.filters = filters || [];
            initFilters.call(object, [object.resizeFilter], (resizeFilters: unknown[]) => {
                object.resizeFilter = resizeFilters[0];
                const image = new fabric.Image(img as unknown as HTMLImageElement, object);
                callback(image, false);
            });
        });
    }).catch(() => {
        _failedImageUrls.add(object.src);
        callback(null, true);
    });
};

// ── 类型定义 ──────────────────────────────────────────────────────────────

// ═══════════════════════════════════════════════════════════════════════════
// 引擎
// ═══════════════════════════════════════════════════════════════════════════

export class FabricEngine implements Engine {
    /** LRU 池：键为模板 MD5，值按最近使用排序 */
    readonly #canvasPool = new ObjectPool<fabric.StaticCanvas>({
        max: 10,
        onEvict: (c) => {
            c.clear();
            try { c.dispose(); } catch { /* ignore */ }
        },
    });
    #initialized = false;

    async init(): Promise<void> {
        this.#initialized = true;
    }

    async render(params: {
        options: RenderOptions;
        templateJson: FabricTemplateJson;
        variables: Record<string, string>;
    }): Promise<Buffer> {
        if (!this.#initialized) {
            throw new Error("FabricEngine not initialized, call init() first");
        }

        const bgW = Number(params.templateJson.backgroundImage?.width) || 1280;
        const bgH = Number(params.templateJson.backgroundImage?.height) || 800;
        const {width = bgW, height = bgH, format, quantity, pixelRatio = 1, compressLevel = 0} = params.options;
        const pw = Math.ceil(width * pixelRatio);
        const ph = Math.ceil(height * pixelRatio);
        const json = params.templateJson;
        const perf = new PerfTimer("render");

        // (a) 变量替换
        const resolvedJson = resolveVariables(json, params.variables);
        perf.mark("resolve");

        // (b) 预下载图片
        await this.#preloadImages(resolvedJson);
        perf.mark("preload");

        // (c) 渲染到 Skia 画布
        const cacheKey = createHash('md5').update(JSON.stringify({options: params.options, templateJson: params.templateJson})).digest('hex');
        const fabricCanvas = this.#canvasPool.acquire(cacheKey, () => {
            const rawCanvas = patchCanvas(new Canvas(pw, ph));
            return new fabric.StaticCanvas(rawCanvas as unknown as HTMLCanvasElement, {
                width: pw,
                height: ph,
                renderOnAddRemove: false,
            });
        });
        if (fabricCanvas.getObjects().length === 0) fabricCanvas.clear();

        if (fabricCanvas.getObjects().length > 0) {
            // (c1) 缓存命中且有对象 → 增量更新 text / src
            this.#smartUpdate(fabricCanvas, resolvedJson);
        } else {
            // (c2) 首次或清空后 → 全量加载
            await this.#loadJson(fabricCanvas, resolvedJson);
        }
        perf.mark("fabric");

        // (d) 编码输出
        const skCanvas = (fabricCanvas as unknown as { lowerCanvasEl: Canvas }).lowerCanvasEl;

        let result: Buffer;
        if (format === "png") {
            const pixels = skCanvas.toBufferSync("raw");
            perf.mark("pixels");
            result = encodePngRgba(pixels, pw, ph, compressLevel);
            perf.mark("encode");
        } else {
            result = skCanvas.toBufferSync(format, {quality: quantity/100}) as Buffer;
            perf.mark("pixels+encode");
        }
        logger.info({steps: perf.steps(), format, size: `${pw}x${ph}`}, "render");
        return result;
    }

    destroy(): void {
        this.#canvasPool.clear();
        this.#initialized = false;
    }

    // ── 私有方法 ──────────────────────────────────────────────────────────

    async #preloadImages(json: FabricTemplateJson): Promise<void> {
        const urls = collectImageUrls(json);
        if (urls.length === 0) return;
        await imageLoader.preload(urls);
    }

    /**
     * 全量加载 JSON 到画布
     *
     * @param skCanvas - Fabric 画布实例
     * @param json - 模板 JSON（变量已替换）
     * @returns 加载完成后的 Promise
     */
    #loadJson(skCanvas: fabric.StaticCanvas, json: FabricTemplateJson): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            try {
                skCanvas.loadFromJSON(json, () => {
                    skCanvas.renderAll();
                    resolve();
                });
            } catch (err) {
                reject(err);
            }
        });
    }

    /**
     * 增量更新画布对象（跳过全量 loadFromJSON）
     *
     * 遍历 resolvedJson 中的对象，按 id 匹配画布上已有对象：
     * - text 类型 → 更新 text 属性
     * - image 类型 → 更新 src 属性
     *
     * @param skCanvas - Fabric 画布实例
     * @param resolvedJson - 变量替换后的模板 JSON
     */
    #smartUpdate(skCanvas: fabric.StaticCanvas, resolvedJson: FabricTemplateJson): void {
        const existing = skCanvas.getObjects();
        for (let i = 0; i < resolvedJson.objects.length; i++) {
            const obj = resolvedJson.objects[i];
            const target = existing[i] as unknown as FabricObjectLike;
            if (obj.id != target.id) continue;
            const type = (obj.type ?? '').toLowerCase();
            if (type.includes('text')) {
                target.set({'text': obj.text ?? '', 'dirty': true});
            } else if (type === 'image') {
                target.set({'src': obj.src ?? '', 'dirty': true});
            }
        }
        skCanvas.renderAll();
    }

}

export {resetFailedImages};
