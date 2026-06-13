import {
    type Engine,
    logger,
    PerfTimer,
    type RenderOptions,
    resolveVariables,
    autoRegisterFonts,
    ObjectPool,
    encodePngRgba
} from "@image-render-server/core";
import {IUIInputData, Leafer, useCanvas} from "@leafer-ui/node";
import {Resource} from "@leafer/core";
import napi from '@napi-rs/canvas'

import {createHash} from "node:crypto";
import {IUI} from "@leafer-ui/interface";
import {LeaferNapiCanvasFontRegistry} from "./leafer-napi-canvas-font-registry.js";

useCanvas('napi', napi) // must

// 字体注册
autoRegisterFonts(new LeaferNapiCanvasFontRegistry(), import.meta.url);

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
    /** LRU 池：键为模板 MD5，值按最近使用排序 */
    readonly #leaferPool = new ObjectPool<Leafer>({
        max: 10,
        onEvict: (leafer) => {
            this.#cacheKeyMap.delete(leafer);
            leafer.destroy();
        },
    });
    #initialized = false;
    /** 记录每个 Leafer 实例的 cacheKey，用于缓存命中判断 */
    #cacheKeyMap = new WeakMap<Leafer, string>();

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
        const json = params.templateJson;
        const perf = new PerfTimer("render");

        // (a) 变量替换
        const resolvedJson = resolveVariables(json, params.variables);
        perf.mark("resolve");
        // MISS：预下载图片 + 全量重建
        await this.#preloadImages(resolvedJson);
        // (b) 判断缓存命中
        const cacheKey = createHash("md5").update(JSON.stringify({
            options: params.options,
            templateJson: json
        })).digest("hex");
        const leafer = this.#leaferPool.acquire(cacheKey, () => new Leafer({width, height, pixelRatio, usePartRender: true}));
        const prevKey = this.#cacheKeyMap.get(leafer);
        const isCacheHit = prevKey === cacheKey && leafer.children.length > 0;

        if (isCacheHit) {
            // HIT：跳过预下载和 clear，仅增量更新变化的属性
            this.#smartUpdate(leafer, resolvedJson);
            leafer.stop();
        } else {
            perf.mark("preload");
            leafer.clear();
            if (resolvedJson.children) {
                leafer.add(resolvedJson.children as unknown as IUIInputData[]);
            }
            this.#cacheKeyMap.set(leafer, cacheKey);
        }
        leafer.start();
        perf.mark("leafer");

        let result: Buffer;
        if (format === "png") {
            const ctx = (leafer.view as any).getContext("2d") as CanvasRenderingContext2D;
            const imageData = ctx.getImageData(0, 0, width, height);
            perf.mark("readPixels");
            result = encodePngRgba(imageData.data, width, height);
            perf.mark("encode");
        } else {
            // Leafer 使用 jpg 而非 jpeg
            result = (await leafer.export(format, {quality: quantity, blob: true, pixelRatio: pixelRatio})).data;
            perf.mark("readPixels+encode");
        }

        logger.info({steps: perf.steps(), format, size: `${width}x${height}`}, "render");
        return result;
    }

    /**
     * 销毁引擎，释放 Leafer 实例资源
     */
    destroy(): void {
        this.#leaferPool.clear();
        this.#initialized = false;
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

    /**
     * 增量更新 Leafer 画布节点 — 仅更新变化的 text/url 属性
     *
     * 按数组索引匹配 + id/name 交叉验证。支持递归处理嵌套子节点。
     *
     * @param leafer - Leafer 画布实例
     * @param resolvedJson - 变量替换后的模板 JSON
     */
    #smartUpdate(leafer: Leafer, resolvedJson: LeaferTemplateJson): void {
        this.#smartUpdateChildren(leafer.children || [], resolvedJson.children ?? []);
    }

    /**
     * 递归更新子节点列表
     *
     * 按数组索引位置匹配，前置 cache hit 保证数据结构一致。
     *
     * @param existing - 现有的 Leafer 叶子节点数组
     * @param newChildren - 新的模板节点数组
     */
    #smartUpdateChildren(existing: IUI[], newChildren: LeaferNode[]): void {
        const len = Math.min(existing.length, newChildren.length);
        for (let i = 0; i < len; i++) {
            const target = existing[i] as any;
            const node = newChildren[i];

            if (node.tag === "Text" && target.tag === "Text") {
                if (target.text !== node.text) {
                    target.set({text: node.text});
                }
            } else if (node.tag === "Image" && target.tag === "Image") {
                if (node.url !== undefined && target.url !== node.url) {
                    target.set({url: node.url});
                }
                // 同时检查 fill.url（Image fill 场景）
                const targetFill = (target.fill || {type: ''}) as any;
                const fill = node.fill as any;
                if (
                    node.fill &&
                    fill.type === "image" &&
                    targetFill.type === "image" &&
                    targetFill.url !== fill.url
                ) {
                    targetFill.url = fill.url;
                }
            }

            // 递归处理嵌套子节点
            if (target.children && target.children.length > 0 && node.children && node.children.length > 0) {
                this.#smartUpdateChildren(target.children, node.children);
            }
        }
    }
}

/**
 * 收集 JSON 中所有图片 URL
 */
function collectImageUrls(json: LeaferTemplateJson): string[] {
    const urls = new Set<string>();

    function walk(childs: LeaferNode[]): void {
        if (!childs || !childs.length) return;
        for (const child of childs) {
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
