/**
 * Piscina Worker — 在独立线程中执行 Fabric 5 渲染任务。
 *
 * Piscina 自动调用本文件的 default export，Worker 常驻内存复用 FabricEngine 实例。
 * 字体注册在 fabric.engine.ts 模块初始化时自动完成。
 */
import {createRenderWorker} from "@image-render-server/core";
import {FabricEngine} from "./fabric.engine.js";

export default await createRenderWorker(FabricEngine);
