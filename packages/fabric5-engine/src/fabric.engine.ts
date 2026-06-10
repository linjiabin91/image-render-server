import {type Engine, logger, type RenderOptions, PerfTimer} from "@render-server/core";
import {Canvas, FontLibrary, loadImage} from 'skia-canvas';
import {fabric} from 'fabric';
import {fileURLToPath} from 'node:url';
import {dirname, resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {CompressionType, Transformer} from '@napi-rs/image';
import {
    existsSync,
    mkdirSync,
    readdirSync,
    readFileSync,
    renameSync,
    statSync,
    unlinkSync,
    writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import {LRUCache} from 'lru-cache';

// ═══════════════════════════════════════════════════════════════════════════
// 字体管理
// ═══════════════════════════════════════════════════════════════════════════

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const fontsDir = resolve(__dirname, '../../core/fonts');

if (existsSync(fontsDir)) {
    for (const file of readdirSync(fontsDir)) {
        const lower = file.toLowerCase();
        if (!lower.endsWith('.ttf') && !lower.endsWith('.otf')) continue;
        const fullPath = resolve(fontsDir, file);
        if (!statSync(fullPath).isFile()) continue;
        const name = file.slice(0, file.length - (lower.endsWith('.ttf') ? 4 : 4));
        try {
            FontLibrary.use(name, fullPath);
        } catch (err) {
            logger.warn({err, font: name}, "font registration failed");
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Skia Canvas 修补 — 补齐 Fabric 需要的 DOM 方法
// ═══════════════════════════════════════════════════════════════════════════

const patchCanvasElement = (nodeCanvas: Canvas): Canvas => {
    const nc = nodeCanvas as unknown as Record<string, unknown>;
    if (!nc.getAttribute) {
        nc.getAttribute = (name: string) => name === 'dir' ? 'ltr' : null;
    }
    if (!nc.setAttribute) nc.setAttribute = () => {
    };
    if (!nc.removeAttribute) nc.removeAttribute = () => {
    };
    if (!nc.style) Object.defineProperty(nodeCanvas, 'style', {value: {}, writable: true});
    return nodeCanvas;
};

fabric.util.createCanvasElement = () => patchCanvasElement(new Canvas(1, 1, {gpu: false} as any)) as unknown as HTMLCanvasElement;

// ═══════════════════════════════════════════════════════════════════════════
// 图片加载失败追踪
// ═══════════════════════════════════════════════════════════════════════════

let _failedImageUrls: Set<string>;
const resetFailedImages = () => {
    _failedImageUrls = new Set<string>();
};
resetFailedImages();

// ═══════════════════════════════════════════════════════════════════════════
// 多级图片缓存（跨进程共享磁盘 + 进程内 LRU + 请求去重）
// ═══════════════════════════════════════════════════════════════════════════

const SHARED_CACHE_DIR = resolve(tmpdir(), 'image-cache');
const SHARED_CACHE_TTL = 1000 * 60 * 30; // 30 分钟
mkdirSync(SHARED_CACHE_DIR, {recursive: true});

// 定期清理过期缓存
const cleanupTimer = setInterval(() => {
    try {
        const now = Date.now();
        for (const file of readdirSync(SHARED_CACHE_DIR)) {
            const filePath = resolve(SHARED_CACHE_DIR, file);
            try {
                if (statSync(filePath).mtimeMs < now - SHARED_CACHE_TTL) {
                    unlinkSync(filePath);
                }
            } catch { /* ignore */
            }
        }
    } catch { /* ignore */
    }
}, 1000 * 60 * 5);
if (cleanupTimer.unref) cleanupTimer.unref();

const cacheKeyFor = (url: string) => createHash('md5').update(url).digest('hex');
const cachePathFor = (url: string) => resolve(SHARED_CACHE_DIR, cacheKeyFor(url));

/** 进程内 LRU 缓存 */
const imageCache = new LRUCache<string, any>({max: 50, ttl: 1000 * 60 * 30});

/** 请求去重 */
const inflightRequests = new LRUCache<string, Promise<any>>({max: 100, ttl: 1000 * 60 * 5});

/**
 * 从 URL 或磁盘缓存加载图片，返回 skia-canvas 原生 Image
 */
const loadImageWithCache = async (url: string): Promise<unknown> => {
    // 1. 共享磁盘缓存
    const cachePath = cachePathFor(url);
    if (existsSync(cachePath)) {
        try {
            const buf = readFileSync(cachePath);
            const img = await loadImage(buf);
            imageCache.set(url, img);
            return img;
        } catch {
            try {
                unlinkSync(cachePath);
            } catch { /* ignore */
            }
        }
    }

    // 2. 下载原始字节
    const FETCH_TIMEOUT = Number(process.env.IMAGE_FETCH_TIMEOUT) || 10_000;
    const response = await fetch(url, {signal: AbortSignal.timeout(FETCH_TIMEOUT)});
    if (!response.ok) {
        throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());

    // 3. 原子写入磁盘缓存
    const tmpPath = cachePath + '.' + process.pid;
    writeFileSync(tmpPath, buffer);
    try {
        renameSync(tmpPath, cachePath);
    } catch {
        try {
            unlinkSync(tmpPath);
        } catch { /* ignore */
        }
    }

    // 4. 加载到内存
    const img = await loadImage(buffer);
    imageCache.set(url, img);
    return img;
};

// ═══════════════════════════════════════════════════════════════════════════
// CSS 约束修正
// ═══════════════════════════════════════════════════════════════════════════

const normalizeImageOptions = (options: Record<string, unknown> | undefined, imgElement: unknown) => {
    if (!options || !imgElement) return;
    const elemW = (imgElement as Record<string, number>).naturalWidth || (imgElement as Record<string, number>).width || 0;
    const elemH = (imgElement as Record<string, number>).naturalHeight || (imgElement as Record<string, number>).height || 0;
    if (elemW === 0 || elemH === 0) return;

    const optW = Number(options.width) || 0;
    const optH = Number(options.height) || 0;
    if (optW === 0 || optH === 0) return;

    const scaleX = Number(options.scaleX) || 1;
    const scaleY = Number(options.scaleY) || 1;

    if (optW < elemW * 0.9 && optH < elemH * 0.9 && Math.abs(scaleX - scaleY) / Math.max(scaleX, scaleY) < 0.01) {
        const displayW = optW * scaleX;
        const displayH = optH * scaleY;
        options.width = elemW;
        options.height = elemH;
        options.scaleX = displayW / elemW;
        options.scaleY = displayH / elemH;
    }
};

// ═══════════════════════════════════════════════════════════════════════════
// Fabric 拦截器
// ═══════════════════════════════════════════════════════════════════════════

fabric.Image.fromURL = ((url: string, callback: (img?: fabric.Image) => void, imgOptions?: Record<string, unknown>) => {
    const cachedImg = imageCache.get(url);
    if (cachedImg) {
        normalizeImageOptions(imgOptions, cachedImg);
        callback(new fabric.Image(cachedImg as unknown as HTMLImageElement, imgOptions));
        return;
    }

    let loadPromise = inflightRequests.get(url);
    if (!loadPromise) {
        loadPromise = loadImageWithCache(url);
        inflightRequests.set(url, loadPromise);
        loadPromise.finally(() => {
            inflightRequests.delete(url);
        });
    }

    loadPromise.then((imgElement: unknown) => {
        try {
            normalizeImageOptions(imgOptions, imgElement);
            callback(new fabric.Image(imgElement as unknown as HTMLImageElement, imgOptions));
        } catch {
            callback();
        }
    }).catch(() => {
        callback();
    });
}) as unknown as typeof fabric.Image.fromURL;

fabric.util.loadImage = ((url: string, callback: (img: HTMLImageElement | null, isError: boolean) => void) => {
    loadImageWithCache(url)
        .then((image) => callback(image as HTMLImageElement, false))
        .catch(() => callback(null, true));
    return undefined;
}) as unknown as typeof fabric.util.loadImage;

// Fabric 5 的 loadFromJSON 走 fabric.Image.fromObject，需拦截做 CSS 修正
// eslint-disable-next-line @typescript-eslint/unbound-method
const ImageKlass = fabric.Image as unknown as Record<string, unknown>;
ImageKlass.fromObject = function (_object: Record<string, unknown>, callback: (img: fabric.Image | null, isError: boolean) => void) {
    const object = fabric.util.object.clone(_object);
    fabric.util.loadImage(object.src, ((img: HTMLImageElement | null, isError: boolean) => {
        if (isError || !img) {
            _failedImageUrls.add(object.src);
            callback(null, true);
            return;
        }
        normalizeImageOptions(object, img);
        const ImageProto = fabric.Image.prototype as unknown as Record<string, unknown>;
        const initFilters = ImageProto._initFilters as (this: unknown, filters: unknown[], cb: (f: unknown[]) => void) => void;
        initFilters.call(object, object.filters || [], (filters: unknown[]) => {
            object.filters = filters || [];
            initFilters.call(object, [object.resizeFilter], (resizeFilters: unknown[]) => {
                object.resizeFilter = resizeFilters[0];
                const image = new fabric.Image(img, object);
                callback(image, false);
            });
        });
    }) as (img: HTMLImageElement) => void, null, object.crossOrigin);
};

// ── 类型定义 ──────────────────────────────────────────────────────────────

export interface FabricObject {
    type: string;
    id?: string;
    name?: string;
    src?: string;
    text?: string;

    [key: string]: unknown;
}

export interface FabricTemplateJson {
    version: string;
    background?: string;
    objects: FabricObject[];
    clipPath?: Record<string, unknown>;
    backgroundImage?: Record<string, unknown>;

    [key: string]: unknown;
}

// ═══════════════════════════════════════════════════════════════════════════
// 引擎
// ═══════════════════════════════════════════════════════════════════════════

export class FabricEngine implements Engine {
    #canvasPool = new Map<string, fabric.StaticCanvas>();
    static #POOL_MAX = 10;
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
        const resolvedJson = this.#resolveVariables(json, params.variables);
        perf.mark("resolve");

        // (b) 预下载图片
        await this.#preloadImages(resolvedJson);
        perf.mark("preload");

        // (c) 渲染到 Skia 画布
        const cacheKey = createHash('md5').update(JSON.stringify({options: params.options, templateJson: params.templateJson})).digest('hex');
        const fabricCanvas = this.#getCanvas(pw, ph, cacheKey);

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
        if (format === "png" ) {
            // PNG因为无法控制压缩率导致必须手动采样再压缩才会更快，因此先用 raw buffer + @napi-rs/image
            const pixels = skCanvas.toBufferSync("raw");
            perf.mark("pixels");
            const tx = Transformer.fromRgbaPixels(pixels, pw, ph);
            result = await tx.png({compressionType: compressLevel == 0 ? CompressionType.Default : (compressLevel == 1 ? CompressionType.Best : CompressionType.Fast)});
            perf.mark("encode");
        } else {
            // 其他格式：skia-canvas 原生编码，跳过 raw buffer + @napi-rs/image 步骤
            result = skCanvas.toBufferSync(format, {quality: quantity/100} as any);
            perf.mark("pixels+encode");
        }
        logger.info({steps: perf.steps(), format, size: `${pw}x${ph}`}, "render");
        return result;
    }

    destroy(): void {
        for (const canvas of this.#canvasPool.values()) {
            canvas.clear();
            try {
                canvas.dispose();
            } catch { /* skia Canvas 无 parentNode */
            }
        }
        this.#canvasPool.clear();
        this.#initialized = false;
    }

    // ── 私有方法 ──────────────────────────────────────────────────────────

    #resolveVariables(json: FabricTemplateJson, variables: Record<string, string>): FabricTemplateJson {
        const str = JSON.stringify(json);
        const resolved = str.replace(/\{\{(\w+)}}/g, (_, key: string) => variables[key] ?? `{{${key}}}`);
        return JSON.parse(resolved) as FabricTemplateJson;
    }

    async #preloadImages(json: FabricTemplateJson): Promise<void> {
        const urls = collectImageUrls(json);
        if (urls.length === 0) return;

        await Promise.all(
            urls.map((url) => {
                if (!imageCache.has(url)) {
                    const p = loadImageWithCache(url).then((img) => {
                        imageCache.set(url, img);
                        return img;
                    }).catch((err: Error) => {
                        logger.warn({err, url: url.slice(0, 80)}, "image load failed");
                        return null;
                    });
                    imageCache.set(url, p);
                }
                return imageCache.get(url);
            }),
        );
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
            const target = existing[i];
            if (obj.id != (target as any).id) continue;
            const type = (obj.type ?? '').toLowerCase();
            if (type.includes('text')) {
                (target as any).set({'text': obj.text ?? '', 'dirty': true});
            } else if (type === 'image') {
                (target as any).set({'src': obj.src ?? '', 'dirty': true});
            }
        }
        skCanvas.renderAll();
    }

    /**
     * 获取或创建画布实例（池化管理）
     *
     * 以模板 MD5 为 key，同一模板复用画布对象。
     * 已有对象时保留（render 中走增量更新），否则清空重用。
     * 超限时淘汰最早使用的画布。
     *
     * @param width - 画布宽度
     * @param height - 画布高度
     * @param key - 缓存键（md5(options + templateJson)）
     * @returns Fabric 画布实例
     */
    #getCanvas(width: number, height: number, key: string): fabric.StaticCanvas {
        if (this.#canvasPool.has(key)) {
            const c = this.#canvasPool.get(key)!;
            this.#canvasPool.delete(key);
            this.#canvasPool.set(key, c);
            // 已有对象则保留（render 中会走增量更新），否则清空重用
            if (c.getObjects().length === 0) c.clear();
            return c;
        }

        if (this.#canvasPool.size >= FabricEngine.#POOL_MAX) {
            const oldestKey = this.#canvasPool.keys().next().value!;
            const oldest = this.#canvasPool.get(oldestKey)!;
            oldest.clear();
            try {
                oldest.dispose();
            } catch { /* ignore */
            }
            this.#canvasPool.delete(oldestKey);
        }

        const rawCanvas = patchCanvasElement(new Canvas(width, height, {gpu: false} as any));
        const fabricCanvas = new fabric.StaticCanvas(rawCanvas as unknown as HTMLCanvasElement, {
            width,
            height,
            renderOnAddRemove: false,
        });
        this.#canvasPool.set(key, fabricCanvas);
        return fabricCanvas;
    }

}

// ── 工具函数 ──────────────────────────────────────────────────────────────

function collectImageUrls(json: FabricTemplateJson): string[] {
    const urls = new Set<string>();
    for (const obj of json.objects) {
        if (obj.type === "image" && obj.src) urls.add(obj.src);
    }
    if (json.backgroundImage?.src) urls.add(json.backgroundImage.src as string);
    return [...urls];
}

export {resetFailedImages};
