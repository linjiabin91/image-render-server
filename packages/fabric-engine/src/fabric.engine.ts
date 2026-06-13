import {type Engine, logger, PerfTimer, type RenderOptions, resolveVariables, autoRegisterFonts, createHttpImageLoader, ObjectPool, patchCanvas, encodePngRgba, normalizeImageOptions, collectImageUrls} from "@image-render-server/core";
import type {ImageLike, FabricTemplateJson, FabricObjectLike} from "@image-render-server/core";
import {SkiaFontRegistry} from "./skia-font-registry.js";
import {Canvas, loadImage} from 'skia-canvas';

import {FabricImage, getEnv, getFabricDocument, setEnv, StaticCanvas} from 'fabric/node';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {tmpdir} from 'node:os';

// ═══════════════════════════════════════════════════════════════════════════
// 字体管理
// ═══════════════════════════════════════════════════════════════════════════

autoRegisterFonts(new SkiaFontRegistry(), import.meta.url);

// ═══════════════════════════════════════════════════════════════════════════
// 图片加载器（三级缓存：LRU → 磁盘 → HTTP）
// ═══════════════════════════════════════════════════════════════════════════

const imageLoader = createHttpImageLoader(async (buf) => loadImage(buf), {
    cacheDir: resolve(tmpdir(), 'fabric7-image-cache'),
});

const origDoc = getFabricDocument();
const proxyDoc = new Proxy(origDoc, {
    get(target, prop, receiver) {
        if (prop === 'createElement') {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- jsdom createElement
            return (tagName: string, options?: any) => {
                if (tagName.toLowerCase() === 'canvas') {
                    return patchCanvas(new Canvas(1, 1));
                }
                return Reflect.get(target, prop, receiver)(tagName, options);
            };
        }
        return Reflect.get(target, prop, receiver);
    },
});
setEnv({...getEnv(), document: proxyDoc});

// ═══════════════════════════════════════════════════════════════════════════
// Fabric 7 拦截 — 图片加载走 @napi-rs/canvas
// ═══════════════════════════════════════════════════════════════════════════
// util.createImage / loadImage 是 non-configurable getter，无法替换。
// loadFromJSON 走 FabricImage.fromObject（可写），在此处拦截。

const _fromObjectOrig = FabricImage.fromObject.bind(FabricImage);
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- fabric fromObject accepts dynamic payloads
FabricImage.fromObject = ((object: any) => {
    if (object.src) {
        const cached = imageLoader.getCached(object.src) as ImageLike | undefined;
        if (cached) {
            normalizeImageOptions(object, cached);
            return new FabricImage(cached as unknown as HTMLImageElement, object);
        }
        return imageLoader.load(object.src).then((el: unknown) => {
            normalizeImageOptions(object, el as ImageLike);
            return new FabricImage(el as unknown as HTMLImageElement, object);
        });
    }
    return _fromObjectOrig(object);
}) as unknown as typeof FabricImage.fromObject;

// fromURL 备选路径
FabricImage.fromURL = ((url: string, callback?: (img?: FabricImage) => void, imgOptions?: Record<string, unknown>) => {
    const cached = imageLoader.getCached(url) as ImageLike | undefined;
    if (cached) {
        normalizeImageOptions(imgOptions, cached);
        callback?.(new FabricImage(cached as unknown as HTMLImageElement, imgOptions));
        return;
    }
    imageLoader.load(url).then((el: unknown) => {
        normalizeImageOptions(imgOptions, el as ImageLike);
        callback?.(new FabricImage(el as unknown as HTMLImageElement, imgOptions));
    }).catch(() => callback?.());
}) as unknown as typeof FabricImage.fromURL;

// ── 类型 ──────────────────────────────────────────────────────────────────

// ═══════════════════════════════════════════════════════════════════════════
// 引擎
// ═══════════════════════════════════════════════════════════════════════════

export class FabricEngine implements Engine {
    /** LRU 池：键为模板 MD5，值按最近使用排序 */
    readonly #canvasPool = new ObjectPool<StaticCanvas>({
        max: 10,
        onEvict: (c) => {
            c.clear();
            try { c.dispose(); } catch { /* ignore */ }
        },
    });
    #ready = false;

    async init(): Promise<void> {
        this.#ready = true;
    }

    async render(params: {
        options: RenderOptions;
        templateJson: FabricTemplateJson;
        variables: Record<string, string>;
    }): Promise<Buffer> {
        if (!this.#ready) throw new Error("FabricEngine not initialized");

        const defW = Number(params.templateJson.backgroundImage?.width) || Number(params.templateJson.clipPath?.width) || 1280;
        const defH = Number(params.templateJson.backgroundImage?.height) || Number(params.templateJson.clipPath?.height) || 800;
        const {width = defW, height = defH, format, quantity, pixelRatio = 1, compressLevel = 0} = params.options;
        const pw = Math.ceil(width * pixelRatio);
        const ph = Math.ceil(height * pixelRatio);
        const json = params.templateJson;
        const perf = new PerfTimer("render");

        const resolved = resolveVariables(json, params.variables);
        perf.mark("resolve");

        await this.#preload(resolved);
        perf.mark("preload");

        // (c) 渲染
        const cacheKey = createHash('md5').update(JSON.stringify({
            options: params.options,
            templateJson: params.templateJson
        })).digest('hex');
        const fc = this.#canvasPool.acquire(cacheKey, () => {
            const raw = patchCanvas(new Canvas(pw, ph));
            return new StaticCanvas(raw as unknown as HTMLCanvasElement, {width: pw, height: ph, renderOnAddRemove: false});
        });
        if (fc.getObjects().length === 0) fc.clear();

        if (fc.getObjects().length > 0) {
            // 缓存命中且有对象 → 增量更新 text / src
            this.#smartUpdate(fc, resolved);
        } else {
            await this.#loadJSON(fc, resolved);
        }
        perf.mark("fabric");

        // (d) 编码输出
        const skCanvas = (fc as unknown as { lowerCanvasEl: { toBufferSync: (fmt: string, opts?: Record<string, unknown>) => Buffer } }).lowerCanvasEl;

        let result: Buffer;
        if (format === "png") {
            const pixels = skCanvas.toBufferSync("raw");
            perf.mark("pixels");
            result = encodePngRgba(pixels, pw, ph, compressLevel);
            perf.mark("encode");
        } else {
            result = skCanvas.toBufferSync(format, {quality: quantity / 100}) as Buffer;
            perf.mark("pixels+encode");
        }

        logger.info({steps: perf.steps(), format, size: `${pw}x${ph}`}, "render");
        return result;
    }

    destroy(): void {
        this.#canvasPool.clear();
        this.#ready = false;
    }

    // ── private ──

    async #preload(j: FabricTemplateJson): Promise<void> {
        const urls = collectImageUrls(j);
        if (!urls.length) return;
        await imageLoader.preload(urls);
    }

    /**
     * 增量更新画布对象（跳过全量 loadFromJSON）
     *
     * @param skCanvas - Fabric 画布实例
     * @param resolvedJson - 变量替换后的模板 JSON
     */
    #smartUpdate(skCanvas: StaticCanvas, resolvedJson: FabricTemplateJson): void {
        const existing = skCanvas.getObjects() as unknown as FabricObjectLike[];
        for (const obj of resolvedJson.objects) {
            if (!obj.id) continue;
            const target = existing.find((o) => o.id === obj.id);
            if (!target) continue;
            const type = (obj.type ?? '').toLowerCase();
            if (type.includes('text')) {
                target.set('text', obj.text ?? '');
            } else if (type === 'image') {
                target.set('src', obj.src ?? '');
            }
        }
        skCanvas.renderAll();
    }

    #loadJSON(skCanvas: StaticCanvas, json: FabricTemplateJson): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            try {
                skCanvas.loadFromJSON(json).then(() => {
                    // Fabric 5 与 Fabric 7 的坐标原点不同：
                    //   Fabric 5: left/top = 左上角
                    //   Fabric 7: left/top = 中心点
                    // 仅对 Fabric 5 模板做位置修正
                    const isFabric5 = String(json.version ?? '').startsWith('5');
                    if (isFabric5) {
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- fabric5→7 migration
                        const fix = (obj: any) => {
                            if (!obj || obj._f5fixed) return;
                            obj._f5fixed = true; // 防止重复修正
                            const w = Number(obj.width) || 0;
                            const h = Number(obj.height) || 0;
                            const sx = Number(obj.scaleX) || 1;
                            const sy = Number(obj.scaleY) || 1;
                            obj.left = (obj.left || 0) + (w * sx) / 2;
                            obj.top = (obj.top || 0) + (h * sy) / 2;
                            obj.setCoords?.();
                        };
                        skCanvas.forEachObject((obj) => fix(obj));
                        if (skCanvas.backgroundImage) fix(skCanvas.backgroundImage);
                        if (skCanvas.clipPath) fix(skCanvas.clipPath);
                    }
                    skCanvas.renderAll();
                    resolve();
                });
            } catch (err) {
                reject(err);
            }
        });
    }

}

