/**
 * Piscina Worker — 在独立线程中执行 Leafer 渲染任务。
 *
 * Piscina 自动调用本文件的 default export，Worker 常驻内存复用 LeaferEngine 实例。
 */
import type {RenderOptions} from "@render-server/core";
import {autoRegisterFonts} from "@render-server/core";
import {LeaferEngine, type LeaferTemplateJson} from "./leafer.engine.js";
import {LeaferNapiCanvasFontRegistry} from "./leafer-napi-canvas-font-registry.js";

// 扫描并注册所有字体
autoRegisterFonts(new LeaferNapiCanvasFontRegistry(), import.meta.url);
const engine = new LeaferEngine();

/** Worker 接收的渲染参数 */
export interface RenderTask {
  options: RenderOptions;
  templateJson: LeaferTemplateJson;
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
