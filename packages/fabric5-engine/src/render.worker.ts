/**
 * Piscina Worker — 在独立线程中执行 Fabric 渲染任务。
 *
 * Piscina 自动调用本文件的 default export，Worker 常驻内存复用 FabricEngine 实例。
 * 字体注册在 fabric.engine.ts 模块初始化时自动完成（FontLibrary.use）。
 */
import type {RenderOptions} from "@render-server/core";
import {FabricEngine, type FabricTemplateJson} from "./fabric.engine.js";

const engine = new FabricEngine();

/** Worker 接收的渲染参数 */
export interface RenderTask {
    options: RenderOptions;
    templateJson: FabricTemplateJson;
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
