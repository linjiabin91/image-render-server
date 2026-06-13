/**
 * Piscina Worker — 在独立线程中执行 Leafer 渲染任务。
 *
 * Piscina 自动调用本文件的 default export，Worker 常驻内存复用 LeaferEngine 实例。
 * 字体注册在 leafer.engine.ts 模块初始化时自动完成。
 */
import {createRenderWorker} from "@image-render-server/core";
import {LeaferEngine} from "./leafer.engine.js";

export default await createRenderWorker(LeaferEngine);
