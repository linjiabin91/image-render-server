/**
 * 引擎服务端启动工厂
 *
 * 各引擎的 server.ts 几乎完全相同（App + getWorkerPath + 直接运行守卫），
 * 此处封装公共模式，每个引擎只需提供名称和 import.meta.url。
 */
import {App} from "./app.js";
import {fileURLToPath} from "node:url";
import {resolve} from "node:path";

/**
 * 创建引擎服务端启动函数
 *
 * 封装 Piscina worker 路径解析、App 挂载和直接运行守卫。
 * 返回的 startServer 函数可在测试或程序化调用时使用。
 *
 * @param name - 引擎名称（用于日志标签，如 "FabricEngine"）
 * @param metaUrl - 引擎模块的 import.meta.url
 * @returns startServer 函数
 *
 * @example
 * ```ts
 * // server.ts
 * import {createEngineServer} from "@render-server/server";
 * export const startServer = createEngineServer("KonvaEngine", import.meta.url);
 * ```
 */
export function createEngineServer(name: string, metaUrl: string): (port: number) => Promise<void> {
  const getWorkerPath = (): string => {
    const workerUrl = new URL("render.worker", metaUrl);
    workerUrl.pathname += metaUrl.endsWith(".ts") ? ".ts" : ".js";
    return workerUrl.pathname;
  };

  const startServer = async (port: number): Promise<void> => {
    const app = new App(port, getWorkerPath());
    await app.start();
    console.log(`[${name}] Server started on http://127.0.0.1:${port}`);
  };

  // 直接运行时启动服务
  if (process.argv[1] && fileURLToPath(metaUrl) === resolve(process.argv[1])) {
    const port = Number(process.env.PORT) || 3000;
    startServer(port).catch((err) => {
      console.error(`[${name}] Failed to start:`, err);
      process.exit(1);
    });
  }

  return startServer;
}
