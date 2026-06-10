/**
 * Piscina Worker — 在独立线程中执行 Konva 渲染任务。
 *
 * Piscina 自动调用本文件的 default export，Worker 常驻内存复用 KonvaEngine 实例。
 * 字体注册在 konva.engine.ts 模块初始化时自动完成（GlobalFonts.registerFromPath）。
 */
import type {RenderOptions} from "@render-server/core";
import {KonvaEngine, type KonvaTemplateJson} from "./konva.engine.js";

const engine = new KonvaEngine();

/** Worker 接收的渲染参数 */
export interface RenderTask {
    options: RenderOptions;
    templateJson: KonvaTemplateJson;
    variables: Record<string, string>;
}

/**
 * 默认导出 — Piscina 自动调用
 *
 * @param params - 渲染参数
 * @returns 渲染结果图片的 Buffer
 */
export default async function render(params: RenderTask): Promise<Buffer> {
    return engine.render(params);
}

// Worker 初始化
await engine.init();
