/**
 * Piscina Worker — 在独立线程中执行 Konva 渲染任务。
 *
 * Piscina 自动调用本文件的 default export，Worker 常驻内存复用 KonvaEngine 实例。
 * 字体注册在 konva.engine.ts 模块初始化时自动完成。
 */
import {createRenderWorker} from "@render-server/core";
import {KonvaEngine} from "./konva.engine.js";

export default await createRenderWorker(KonvaEngine);
