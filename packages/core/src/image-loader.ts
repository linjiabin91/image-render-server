/**
 * 图片加载器接口与工厂函数
 *
 * 提供统一的图片加载、缓存、预加载抽象，各引擎根据不同需求选择
 * 合适的加载器实现：
 *
 * - createHttpImageLoader: 完整的三级缓存（LRU → 磁盘 → HTTP），
 *   适用于 fabric-engine、fabric5-engine、konva-engine
 * - createNoopImageLoader: 空加载器，仅记录 URL 列表，
 *   适用于 leafer-engine（委托给 Resource）、playwright-engine（浏览器加载）
 */
import {LRUCache} from 'lru-cache';

import {createHash, randomUUID} from 'node:crypto';
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
import {resolve} from 'node:path';
import {tmpdir} from 'node:os';

// ═══════════════════════════════════════════════════════════════════════════
// 类型定义
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 图片加载器接口
 *
 * 提供异步加载、批量预加载、同步缓存获取和清空功能。
 */
export interface ImageLoader {
    /**
     * 异步加载图片
     *
     * 当图片已在 LRU 缓存中时同步返回。
     *
     * @param url - 图片 URL
     * @returns 加载完成的图片对象
     */
    load(url: string): Promise<unknown>;

    /**
     * 批量预加载图片
     *
     * 并发加载所有指定 URL，加载结果存入缓存供后续渲染阶段使用。
     *
     * @param urls - 图片 URL 数组
     */
    preload(urls: string[]): Promise<void>;

    /**
     * 同步获取已缓存的图片对象
     *
     * 用于渲染阶段的同步调用，仅返回 LRU 缓存中已存在的图片。
     *
     * @param url - 图片 URL
     * @returns 缓存的图片对象，如未缓存则返回 undefined
     */
    getCached(url: string): unknown | undefined;

    /**
     * 清空进程内缓存
     */
    clear(): void;
}

/**
 * 图片解码器类型
 *
 * 接收原始 Buffer 和原始 URL，返回解码后的图片对象。
 *
 * @param buffer - 图片原始字节
 * @param url - 图片原始 URL（用于错误日志等）
 * @returns 解码后的图片对象
 */
export type ImageDecoder = (buffer: Buffer, url: string) => Promise<unknown>;

/**
 * createHttpImageLoader 选项
 */
export interface HttpImageLoaderOptions {
    /**
     * LRU 缓存最大条目数（默认 50）
     */
    maxSize?: number;

    /**
     * LRU 缓存 TTL（毫秒，默认 30 分钟）
     */
    ttlMs?: number;

    /**
     * 磁盘缓存目录（默认 tmpdir/image-cache-{random}）
     */
    cacheDir?: string;

    /**
     * 磁盘缓存 TTL（毫秒，默认 30 分钟）
     */
    diskCacheTtlMs?: number;

    /**
     * 清理定时器间隔（毫秒，默认 5 分钟，设为 0 禁用自动清理）
     */
    cleanupIntervalMs?: number;

    /**
     * HTTP 请求超时（毫秒，默认 10 秒，优先于 process.env.IMAGE_FETCH_TIMEOUT）
     */
    fetchTimeoutMs?: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// 工厂函数
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 创建完整的 HTTP 图片加载器
 *
 * 包含三级缓存策略：
 * 1. 进程内 LRU 缓存（最快，同步访问）
 * 2. 磁盘缓存（跨进程共享，原子写入避免冲突）
 * 3. HTTP 网络请求（最终回退）
 *
 * 同时提供请求去重（inflight 表）和磁盘自动清理定时器。
 *
 * @param decode - 图片解码函数
 * @param options - 配置选项
 * @returns ImageLoader 实例
 */
export const createHttpImageLoader = (
    decode: ImageDecoder,
    options?: HttpImageLoaderOptions,
): ImageLoader => {
    const {
        maxSize = 50,
        ttlMs = 1000 * 60 * 30,
        diskCacheTtlMs = 1000 * 60 * 30,
        cleanupIntervalMs = 1000 * 60 * 5,
        fetchTimeoutMs = Number(process.env.IMAGE_FETCH_TIMEOUT) || 10_000,
        cacheDir = resolve(tmpdir(), `image-cache-${randomUUID().slice(0, 8)}`),
    } = options ?? {};

    mkdirSync(cacheDir, {recursive: true});

    const cacheKeyFor = (url: string) => createHash('md5').update(url).digest('hex');
    const cachePathFor = (url: string) => resolve(cacheDir, cacheKeyFor(url));

    /** 进程内 LRU 缓存 */
    const imageCache = new LRUCache<string, object>({max: maxSize, ttl: ttlMs});

    /** 请求去重表 */
    const inflightRequests = new LRUCache<string, Promise<object>>({max: 100, ttl: 1000 * 60 * 5});

    // ── 磁盘自动清理定时器 ────────────────────────────────────────────

    let cleanupTimer: ReturnType<typeof setInterval> | undefined;
    if (cleanupIntervalMs > 0) {
        cleanupTimer = setInterval(() => {
            try {
                const now = Date.now();
                for (const file of readdirSync(cacheDir)) {
                    const fp = resolve(cacheDir, file);
                    try {
                        if (statSync(fp).mtimeMs < now - diskCacheTtlMs) {
                            unlinkSync(fp);
                        }
                    } catch { /* 文件已被其他进程删除 */
                    }
                }
            } catch { /* 目录可能已被删除 */
            }
        }, cleanupIntervalMs);
        if (cleanupTimer.unref) cleanupTimer.unref();
    }

    // ── 核心加载函数 ──────────────────────────────────────────────────

    const loadImageWithCache = async (url: string): Promise<unknown> => {
        const cp = cachePathFor(url);

        // 1. 检查磁盘缓存
        if (existsSync(cp)) {
            try {
                const buf = readFileSync(cp);
                const img = await decode(buf, url);
                imageCache.set(url, img as object);
                return img;
            } catch {
                // 磁盘缓存损坏，删除后重试
                try {
                    unlinkSync(cp);
                } catch { /* ignore */
                }
            }
        }

        // 2. HTTP 下载
        const res = await fetch(url, {signal: AbortSignal.timeout(fetchTimeoutMs)});
        if (!res.ok) {
            throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
        }
        const buf = Buffer.from(await res.arrayBuffer());

        // 3. 原子写入磁盘缓存
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

        // 4. 解码并加入 LRU
        const img = await decode(buf, url);
        imageCache.set(url, img as object);
        return img;
    };

    // ── 公开接口 ──────────────────────────────────────────────────────

    const loader: ImageLoader = {
        async load(url: string): Promise<unknown> {
            const cached = imageCache.get(url);
            if (cached !== undefined) return cached;

            let p = inflightRequests.get(url);
            if (!p) {
                p = loadImageWithCache(url) as Promise<object>;
                inflightRequests.set(url, p);
                p = p.finally(() => {
                    inflightRequests.delete(url);
                });
            }
            return p as Promise<unknown>;
        },

        async preload(urls: string[]): Promise<void> {
            await Promise.all(urls.map((url) => loader.load(url).catch(() => {})));
        },

        getCached(url: string): unknown | undefined {
            const v = imageCache.get(url);
            return v as unknown | undefined;
        },

        clear(): void {
            imageCache.clear();
            inflightRequests.clear();
        },
    };

    return loader;
};

/**
 * 创建空加载器
 *
 * 不实际加载任何图片，仅记录 URL 列表。适用于图片加载委托给第三方
 * （如 Leafer 的 Resource）或者由浏览器完成的场景。
 *
 * @returns ImageLoader 实例
 */
export const createNoopImageLoader = (): ImageLoader => {
    const tracked = new Set<string>();

    return {
        async load(_url: string): Promise<unknown> {
            tracked.add(_url);
            return undefined;
        },

        async preload(urls: string[]): Promise<void> {
            for (const url of urls) {
                tracked.add(url);
            }
        },

        getCached(_url: string): unknown | undefined {
            console.log(_url);
            return undefined;
        },

        clear(): void {
            tracked.clear();
        },
    };
};
