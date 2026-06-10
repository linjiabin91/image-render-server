/**
 * Piscina Worker — 在独立线程中执行 Playwright 渲染任务。
 *
 * Piscina 自动调用本文件的 default export，Worker 常驻内存复用 PlaywrightEngine 实例。
 * Worker 启动时连接由 server.ts 启动的 Playwright 浏览器实例。
 */
import {chromium} from "playwright-core";
import type {RenderOptions} from "@render-server/core";
import {PlaywrightEngine} from "./playwright.engine.js";

const endpoint = process.env.PLAYWRIGHT_BROWSER_ENDPOINT;
if (!endpoint) {
  throw new Error("PLAYWRIGHT_BROWSER_ENDPOINT environment variable is not set");
}

const browser = await chromium.connect(endpoint);
const engine = new PlaywrightEngine(browser);
await engine.init();

/** Worker 接收的渲染参数 */
export interface RenderTask {
  options: RenderOptions;
  templateJson: Record<string, unknown>;
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
