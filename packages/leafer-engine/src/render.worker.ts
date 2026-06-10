/**
 * Piscina Worker — 在独立线程中执行 Leafer 渲染任务。
 *
 * Piscina 自动调用本文件的 default export，Worker 常驻内存复用 LeaferEngine 实例。
 */
import type {RenderOptions} from "@render-server/core";
import {LeaferEngine, type LeaferTemplateJson} from "./leafer.engine.js";
import {GlobalFonts} from '@napi-rs/canvas'
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// src/ 和 dist/ 中 ../../core/fonts/ 都指向 packages/core/fonts/
GlobalFonts.registerFromPath(
    join(__dirname, '../../core/fonts/AlibabaPuHuiTi-3-45-Light.ttf'),
    'AlibabaPuHuiTi-3-45-Light'
)
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
