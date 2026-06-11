import {type Engine, logger, PerfTimer, type RenderOptions, resolveVariables} from "@render-server/core";
import {Canvas, FontLibrary, Image, loadImage} from 'skia-canvas';
import {CompressionType, Transformer} from '@napi-rs/image';
import {FabricImage, getEnv, getFabricDocument, setEnv, StaticCanvas, Text as FabricText} from 'fabric/node';
import {createHash} from 'node:crypto';
import {
    existsSync,
    mkdirSync,
    readdirSync,
    readFileSync,
    renameSync,
    statSync,
    unlinkSync,
    writeFileSync
} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {LRUCache} from 'lru-cache';
import {fileURLToPath} from "node:url";

// ═══════════════════════════════════════════════════════════════════════════
// 字体管理
// ═══════════════════════════════════════════════════════════════════════════

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const fontsDir = resolve(__dirname, '../../core/fonts');

if (existsSync(fontsDir)) {
    // 按族名前缀分组：AlibabaPuHuiTi-3-45-Light.ttf → 族名 AlibabaPuHuiTi-3
    const fontGroups = new Map<string, string[]>();
    for (const file of readdirSync(fontsDir)) {
        const lower = file.toLowerCase();
        if (!lower.endsWith('.ttf') && !lower.endsWith('.otf')) continue;
        const fullPath = resolve(fontsDir, file);
        if (!statSync(fullPath).isFile()) continue;
        const name = file.slice(0, file.length - (lower.endsWith('.ttf') ? 4 : 4));
        // 文件名格式：{familyPrefix}-{weightIndex}-{weightName}
        // 去掉最后两段得到族名前缀
        const parts = name.split('-');
        const family = parts.length >= 3 ? parts.slice(0, -2).join('-') : name;
        if (!fontGroups.has(family)) fontGroups.set(family, []);
        fontGroups.get(family)!.push(fullPath);
    }
    for (const [family, paths] of fontGroups) {
        try {
            FontLibrary.use(family, paths.length === 1 ? paths[0] : paths);
        } catch (err) {
            logger.warn({err, font: family}, "font group registration failed");
        }
        // 同时按原始完整名称单个注册，兼容旧模板 fontFamily: 'AlibabaPuHuiTi-3-45-Light'
        for (const path of paths) {
            const name = path.split('/').pop()!.replace(/\.(ttf|otf)$/i, '');
            try {
                FontLibrary.use(name, path);
            } catch (err) {
                logger.warn({err, font: name}, "font alias registration failed");
            }
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// 多级图片缓存（进程内 LRU → 磁盘 → HTTP）
// ═══════════════════════════════════════════════════════════════════════════

const SHARED_CACHE_DIR = resolve(tmpdir(), 'fabric7-image-cache');
const SHARED_CACHE_TTL = 1000 * 60 * 30;
mkdirSync(SHARED_CACHE_DIR, {recursive: true});

const cleanupTimer = setInterval(() => {
    try {
        const now = Date.now();
        for (const file of readdirSync(SHARED_CACHE_DIR)) {
            const fp = resolve(SHARED_CACHE_DIR, file);
            try {
                if (statSync(fp).mtimeMs < now - SHARED_CACHE_TTL) unlinkSync(fp);
            } catch { /* ignore */
            }
        }
    } catch { /* ignore */
    }
}, 1000 * 60 * 5);
if (cleanupTimer.unref) cleanupTimer.unref();

const cacheKeyFor = (url: string) => createHash('md5').update(url).digest('hex');
const cachePathFor = (url: string) => resolve(SHARED_CACHE_DIR, cacheKeyFor(url));

const imageCache = new LRUCache<string, Image>({max: 50, ttl: 1000 * 60 * 30});
const inflightRequests = new LRUCache<string, Promise<unknown>>({max: 100, ttl: 1000 * 60 * 5});

const loadImageWithCache = async (url: string): Promise<Image> => {
    const cp = cachePathFor(url);
    if (existsSync(cp)) {
        try {
            const buf = readFileSync(cp);
            const img = await loadImage(buf);
            imageCache.set(url, img);
            return img;
        } catch {
            try {
                unlinkSync(cp);
            } catch { /* ignore */
            }
        }
    }

    const timeout = Number(process.env.IMAGE_FETCH_TIMEOUT) || 10_000;
    const res = await fetch(url, {signal: AbortSignal.timeout(timeout)});
    if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());

    const tmp = cp + '.' + process.pid;
    writeFileSync(tmp, buf);
    try {
        renameSync(tmp, cp);
    } catch {
        try {
            unlinkSync(tmp);
        } catch { /* ignore */
        }
    }

    const img = await loadImage(buf);
    imageCache.set(url, img);
    return img;
};

// ═══════════════════════════════════════════════════════════════════════════
// Fabric 7 拦截 — 图片加载走 @napi-rs/canvas
// ═══════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════
// CSS 约束修正 — 前端 CSS object-fit 导致的 width/scaleX 错配
// ═══════════════════════════════════════════════════════════════════════════

/** 图片对象最小接口 — 包含 Fabric CSS 约束修正所需的属性 */
interface ImageLike {
    width: number;
    height: number;
    naturalWidth?: number;
    naturalHeight?: number;
}

const normalizeImageOptions = (opts: Record<string, unknown> | undefined, imgEl: ImageLike) => {
    if (!opts || !imgEl) return;
    const ew = imgEl.naturalWidth || imgEl.width || 0;
    const eh = imgEl.naturalHeight || imgEl.height || 0;
    if (!ew || !eh) return;
    const ow = Number(opts.width) || 0;
    const oh = Number(opts.height) || 0;
    if (!ow || !oh) return;
    const sx = Number(opts.scaleX) || 1;
    const sy = Number(opts.scaleY) || 1;
    if (ow < ew * 0.9 && oh < eh * 0.9 && Math.abs(sx - sy) / Math.max(sx, sy) < 0.01) {
        opts.width = ew;
        opts.height = eh;
        opts.scaleX = (ow * sx) / ew;
        opts.scaleY = (oh * sy) / eh;
    }
};

// ═══════════════════════════════════════════════════════════════════════════
// 替换 Fabric 7 内部 document — 拦截 createElement('canvas') 返回 @napi-rs/canvas
// ═══════════════════════════════════════════════════════════════════════════

/** Fabric 7 需要的 canvas 元素最小 DOM 接口 */
interface CanvasElementLike {
    getAttribute(name: string): string | null;
    setAttribute(name: string, value: string): void;
    removeAttribute(name: string): void;
    hasAttribute(name: string): boolean;
    addEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions): void;
    removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | EventListenerOptions): void;
    classList: Pick<DOMTokenList, 'add' | 'remove' | 'contains' | 'toggle'>;
    parentNode: Node | null;
    style: Record<string, string>;
    width: number;
    height: number;
    getContext(contextId: '2d', options?: CanvasRenderingContext2DSettings): CanvasRenderingContext2D | null;
}

const patchEl = (el: Canvas): Canvas & CanvasElementLike => {
    const patched = el as unknown as CanvasElementLike;
    if (!patched.getAttribute) {
        patched.getAttribute = (n: string) => n === 'dir' ? 'ltr' : null;
        patched.setAttribute = () => {};
        patched.removeAttribute = () => {};
        patched.hasAttribute = () => false;
        patched.addEventListener = () => {};
        patched.removeEventListener = () => {};
        patched.classList = { add: () => {}, remove: () => {}, contains: () => false, toggle: () => false };
        patched.parentNode = null;
    }
    if (!patched.style) Object.defineProperty(el, 'style', {value: {}, writable: true});
    return el as Canvas & CanvasElementLike;
};

const origDoc = getFabricDocument();
const proxyDoc = new Proxy(origDoc, {
    get(target, prop, receiver) {
        if (prop === 'createElement') {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- jsdom createElement
            return (tagName: string, options?: any) => {
                if (tagName.toLowerCase() === 'canvas') {
                    return patchEl(new Canvas(1, 1));
                }
                return Reflect.get(target, prop, receiver)(tagName, options);
            };
        }
        return Reflect.get(target, prop, receiver);
    },
});
setEnv({...getEnv(), document: proxyDoc});

// ── Font weight 兼容 patch ────────────────────────────────────────────────
//
// skia-canvas 的 CSS font 匹配比浏览器严格，fontWeight 不匹配时会回退到
// 系统字体而不是自动合成（faux bold）。此处去掉 fontWeight/fontStyle，
// 让 Skia 用分组注册的默认权重匹配，避免因权重不匹配导致回退。
// 注意：若日后需支持 fontWeight 切换变体，可删除此 patch。

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(FabricText.prototype as any)._getFontString = function (this: Record<string, any>) {
    return this.fontSize + 'px "' + this.fontFamily + '"';
};

// ═══════════════════════════════════════════════════════════════════════════
// Fabric 7 拦截 — 图片加载走 @napi-rs/canvas
// ═══════════════════════════════════════════════════════════════════════════
// util.createImage / loadImage 是 non-configurable getter，无法替换。
// loadFromJSON 走 FabricImage.fromObject（可写），在此处拦截。

const _fromObjectOrig = FabricImage.fromObject.bind(FabricImage);
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- fabric fromObject accepts dynamic payloads
FabricImage.fromObject = ((object: any) => {
    if (object.src) {
        const cached = imageCache.get(object.src);
        if (cached) {
            normalizeImageOptions(object, cached);
            return new FabricImage(cached as unknown as HTMLImageElement, object);
        }
        let p = inflightRequests.get(object.src);
        if (!p) {
            p = loadImageWithCache(object.src);
            inflightRequests.set(object.src, p);
            p.finally(() => inflightRequests.delete(object.src));
        }
        return p.then((el: unknown) => {
            normalizeImageOptions(object, el as ImageLike);
            return new FabricImage(el as unknown as HTMLImageElement, object);
        });
    }
    return _fromObjectOrig(object);
}) as unknown as typeof FabricImage.fromObject;

// fromURL 备选路径
FabricImage.fromURL = ((url: string, callback?: (img?: FabricImage) => void, imgOptions?: Record<string, unknown>) => {
    const cached = imageCache.get(url);
    if (cached) {
        normalizeImageOptions(imgOptions, cached);
        callback?.(new FabricImage(cached as unknown as HTMLImageElement, imgOptions));
        return;
    }
    let p = inflightRequests.get(url);
    if (!p) {
        p = loadImageWithCache(url);
        inflightRequests.set(url, p);
        p.finally(() => inflightRequests.delete(url));
    }
    p.then((el: unknown) => {
        normalizeImageOptions(imgOptions, el as ImageLike);
        callback?.(new FabricImage(el as unknown as HTMLImageElement, imgOptions));
    }).catch(() => callback?.());
}) as unknown as typeof FabricImage.fromURL;

// ── 类型 ──────────────────────────────────────────────────────────────────

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
    #pool = new Map<string, StaticCanvas>();
    static #POOL_MAX = 10;
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
        const fc = this.#getCanvas(pw, ph, cacheKey);

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
            // PNG因为无法控制压缩率导致必须手动采样再压缩才会更快，因此先用 raw buffer + @napi-rs/image
            const pixels = skCanvas.toBufferSync("raw");
            perf.mark("pixels");
            const tx = Transformer.fromRgbaPixels(pixels, pw, ph);
            result = await tx.png({compressionType: compressLevel == 0 ? CompressionType.Default : (compressLevel == 1 ? CompressionType.Best : CompressionType.Fast)});
            perf.mark("encode");
        } else {
            // 其他格式：skia-canvas 原生编码，跳过 raw buffer + @napi-rs/image 步骤
            result = skCanvas.toBufferSync(format, {quality: quantity / 100}) as Buffer;
            perf.mark("pixels+encode");
        }

        logger.info({steps: perf.steps(), format, size: `${pw}x${ph}`}, "render");
        return result;
    }

    destroy(): void {
        for (const c of this.#pool.values()) {
            c.clear();
            try {
                c.dispose();
            } catch { /* ignore */
            }
        }
        this.#pool.clear();
        this.#ready = false;
    }

    // ── private ──

    async #preload(j: FabricTemplateJson): Promise<void> {
        const urls = collectImageUrls(j);
        if (!urls.length) return;
        await Promise.all(urls.map(async (u) => {
            if (!imageCache.has(u)) {
                try {
                    const img = await loadImageWithCache(u);
                    imageCache.set(u, img);
                } catch (e: unknown) {
                    logger.warn({err: e, url: u.slice(0, 80)}, "img fail");
                }
            }
        }));
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

    #getCanvas(w: number, h: number, key: string): StaticCanvas {
        if (this.#pool.has(key)) {
            const c = this.#pool.get(key)!;
            this.#pool.delete(key);
            this.#pool.set(key, c);
            if (c.getObjects().length === 0) c.clear();
            return c;
        }
        if (this.#pool.size >= FabricEngine.#POOL_MAX) {
            const k = this.#pool.keys().next().value!;
            const o = this.#pool.get(k)!;
            o.clear();
            try {
                o.dispose();
            } catch { /* ignore */
            }
            this.#pool.delete(k);
        }
        const raw = patchEl(new Canvas(w, h));
        const fc = new StaticCanvas(raw as unknown as HTMLCanvasElement, {width: w, height: h, renderOnAddRemove: false});
        this.#pool.set(key, fc);
        return fc;
    }

}

/** Fabric 对象最小接口 — 用于 smartUpdate 避免 as any */
interface FabricObjectLike {
    id?: string;

    set(key: string, value: unknown): void;

    set(options: Record<string, unknown>): void;
}

function collectImageUrls(j: FabricTemplateJson): string[] {
    const s = new Set<string>();
    for (const o of j.objects) {
        if (o.type === "image" && o.src) s.add(o.src);
    }
    if (j.backgroundImage?.src) s.add(j.backgroundImage.src as string);
    return [...s];
}
