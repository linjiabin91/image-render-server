/**
 * Fabric 引擎共享类型与工具函数
 *
 * fabric-engine 与 fabric5-engine 之间存在大量重复的类型定义和工具函数，
 * 此处统一抽取到 core 包中共享。
 */

// ═══════════════════════════════════════════════════════════════════════════
// 类型定义
// ═══════════════════════════════════════════════════════════════════════════

/** 图片对象最小接口 — 包含 CSS 约束修正所需的属性 */
export interface ImageLike {
    width: number;
    height: number;
    naturalWidth?: number;
    naturalHeight?: number;
}

/** Fabric 模板中的对象节点 */
export interface FabricObject {
    type: string;
    id?: string;
    name?: string;
    src?: string;
    text?: string;

    [key: string]: unknown;
}

/** Fabric 模板 JSON 结构 */
export interface FabricTemplateJson {
    version: string;
    background?: string;
    objects: FabricObject[];
    clipPath?: Record<string, unknown>;
    backgroundImage?: Record<string, unknown>;

    [key: string]: unknown;
}

/** Fabric 对象最小接口 — 用于 smartUpdate 避免 as any */
export interface FabricObjectLike {
    id?: string;

    set(key: string, value: unknown): void;

    set(options: Record<string, unknown>): void;
}

// ═══════════════════════════════════════════════════════════════════════════
// 工具函数
// ═══════════════════════════════════════════════════════════════════════════

/**
 * CSS object-fit 约束修正 — 修正前端 CSS object-fit 导致的 width/scaleX 错配
 *
 * 前端渲染时 CSS object-fit: cover/contain 会改变图片的宽高和缩放比，
 * 服务端需要根据图片实际尺寸修正这些值。
 *
 * @param opts - 图片选项对象（会被原地修改）
 * @param imgEl - 已加载的图片元素
 */
export const normalizeImageOptions = (opts: Record<string, unknown> | undefined, imgEl: ImageLike | undefined): void => {
    if (!opts || !imgEl) return;
    const ew = imgEl.naturalWidth || imgEl.width || 0;
    const eh = imgEl.naturalHeight || imgEl.height || 0;
    if (ew === 0 || eh === 0) return;
    const ow = Number(opts.width) || 0;
    const oh = Number(opts.height) || 0;
    if (ow === 0 || oh === 0) return;
    const sx = Number(opts.scaleX) || 1;
    const sy = Number(opts.scaleY) || 1;
    if (ow < ew * 0.9 && oh < eh * 0.9 && Math.abs(sx - sy) / Math.max(sx, sy) < 0.01) {
        const displayW = ow * sx;
        const displayH = oh * sy;
        opts.width = ew;
        opts.height = eh;
        opts.scaleX = displayW / ew;
        opts.scaleY = displayH / eh;
    }
};

/**
 * 从模板 JSON 中收集所有图片 URL
 *
 * @param json - Fabric 模板 JSON
 * @returns 去重后的 URL 数组
 */
export function collectImageUrls(json: FabricTemplateJson): string[] {
    const urls = new Set<string>();
    for (const obj of json.objects) {
        if (obj.type === "image" && obj.src) urls.add(obj.src);
    }
    if (json.backgroundImage?.src) urls.add(json.backgroundImage.src as string);
    return [...urls];
}
