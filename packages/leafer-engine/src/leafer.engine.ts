import {type Engine, logger, type RenderOptions} from "@render-server/core";
import {Leafer, useCanvas} from "@leafer-ui/node";
import {Resource} from "@leafer/core";
import napi from '@napi-rs/canvas'
import {CompressionType, Transformer} from '@napi-rs/image'

useCanvas('napi', napi) // must

/** Leafer 节点 — 递归结构 */
export interface LeaferNode {
    tag: string;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    text?: string;
    fontSize?: number;
    fontFamily?: string;
    fill?: string | { type: string; url: string };
    url?: string;
    children?: LeaferNode[];

    [key: string]: unknown;
}

/** 模板 JSON — Leafer 场景结构 */
export interface LeaferTemplateJson {
    width: number;
    height: number;
    children: LeaferNode[];

    [key: string]: unknown;
}

/** 图片请求超时（毫秒） */
const IMAGE_FETCH_TIMEOUT = 10000;

/**
 * Leafer 渲染引擎 — 纯渲染实现
 *
 * 在 Piscina worker 线程中调用，每个 Worker 持有长期复用的 Leafer 实例。
 */
export class LeaferEngine implements Engine {
    /** LRU 池：键为 "${width}x${height}"，值按最近使用排序 */
    #leaferPool = new Map<string, Leafer>();
    /** 池子最大容量 */
    static #POOL_MAX = 10;
    #initialized = false;

    /**
     * 初始化引擎，建立 Leafer 画布环境
     */
    async init(): Promise<void> {
        this.#initialized = true;
    }

    /**
     * 执行渲染
     *
     * @param params - 渲染参数
     *   - options: 渲染配置
     *   - templateJson: Leafer JSON 结构
     *   - variables: 变量替换映射
     * @returns 渲染结果图片的 Buffer
     */
    async render(params: {
        options: RenderOptions;
        templateJson: LeaferTemplateJson;
        variables: Record<string, string>;
    }): Promise<Buffer> {
        if (!this.#initialized) {
            throw new Error("LeaferEngine not initialized, call init() first");
        }

        const {width, height, format, quantity, pixelRatio = 1} = params.options;
        const pw = Math.ceil(width * pixelRatio);
        const ph = Math.ceil(height * pixelRatio);
        const json = params.templateJson;
        const perf = this.#perf();

        // (a) 预下载图片
        await this.#preloadImages(json);
        perf.mark("preload");

        // (b) 渲染到 Leafer 画布
        const leafer = this.#getLeafer(pw, ph);
        if (json.children) {
            leafer.add(json.children as any);
        }
        leafer.start();
        perf.mark("leafer");

        let result: Buffer;
        if (format === "png") {
            // PNG：走 getImageData + @napi-rs/image 以获得压缩等级控制
            const ctx = (leafer.view as any).getContext("2d") as CanvasRenderingContext2D;
            const imageData = ctx.getImageData(0, 0, pw, ph);
            perf.mark("readPixels");
            const tx = Transformer.fromRgbaPixels(imageData.data, pw, ph);
            result = tx.pngSync({ compressionType: CompressionType.Default });
            perf.mark("encode");
        } else {
            // 其他格式：leafer 原生导出，跳过 getImageData + @napi-rs/image 步骤
            const leaferFormat = format === 'jpeg' ? 'jpg' : format;
            const exportResult = await (leafer as any).export(leaferFormat, { quality: quantity });
            const data = (exportResult as any).data;
            result = typeof data === 'string'
                ? Buffer.from(data.split(',')[1] || data, 'base64')
                : Buffer.from(data);
            perf.mark("export+encode");
        }

        logger.info({steps: perf.steps(), format, size: `${pw}x${ph}`}, "render");
        return result;
    }

    /** 简易性能计时器 */
    #perf() {
        const marks: Record<string, number> = {};
        let prev = performance.now();
        return {
            mark(name: string) {
                const now = performance.now();
                marks[name] = +(now - prev).toFixed(1);
                prev = now;
            },
            steps() {
                return marks;
            },
        };
    }

    /**
     * 销毁引擎，释放 Leafer 实例资源
     */
    destroy(): void {
        for (const leafer of this.#leaferPool.values()) {
            leafer.destroy();
        }
        this.#leaferPool.clear();
        this.#initialized = false;
    }

    #getLeafer(width: number, height: number): Leafer {
        const key = `${width}x${height}`;

        // 命中了：移到末尾（最近使用），clear 后返回
        if (this.#leaferPool.has(key)) {
            const leafer = this.#leaferPool.get(key)!;
            this.#leaferPool.delete(key);
            this.#leaferPool.set(key, leafer);
            leafer.clear();
            return leafer;
        }

        // 超过上限：淘汰最久未使用的
        if (this.#leaferPool.size >= LeaferEngine.#POOL_MAX) {
            const oldestKey = this.#leaferPool.keys().next().value!;
            this.#leaferPool.get(oldestKey)!.destroy();
            this.#leaferPool.delete(oldestKey);
        }

        const leafer = new Leafer({width, height});
        this.#leaferPool.set(key, leafer);
        return leafer;
    }

    async #preloadImages(json: LeaferTemplateJson): Promise<void> {
        const urls = collectImageUrls(json);

        await Promise.all(
            urls.map((url) =>
                Promise.race([
                    Resource.map?.[url] ?? Resource.loadImage(url),
                    new Promise<never>((_, reject) =>
                        setTimeout(
                            () => reject(new Error(`Image fetch timeout: ${url.slice(0, 80)}`)),
                            IMAGE_FETCH_TIMEOUT,
                        ),
                    ),
                ]).catch((err: Error) => {
                    logger.warn({err, url: url.slice(0, 80)}, "image load failed");
                }),
            ),
        );
    }
}

/**
 * 收集 JSON 中所有图片 URL
 */
function collectImageUrls(json: LeaferTemplateJson): string[] {
    const urls = new Set<string>();

    function walk(childs: LeaferNode[]): void {
        if (!childs || !childs.length) return;
        for (let child of childs) {
            if (child.tag === "Image" && child.url) {
                urls.add(child.url);
            }
            if (child.fill && typeof child.fill === 'object' && child.fill.url) {
                urls.add(child.fill.url);
            }
            if (child.children) {
                walk(child.children);
            }
        }
    }

    walk(json.children);
    return [...urls];
}
