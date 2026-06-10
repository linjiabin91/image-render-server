/**
 * Leafer 引擎服务端启动入口
 *
 * 使用通用的 App 挂载本引擎的 Piscina worker，启动 HTTP 服务。
 */
import {App} from "@render-server/server";
import {fileURLToPath} from "node:url";
import {resolve} from "node:path";

function getWorkerPath(): string {
  const workerUrl = new URL("render.worker", import.meta.url);
  // 当前是 .ts → dev（tsx），worker 也是 .ts
  // 当前是 .js → prod（已编译），worker 也是 .js
  workerUrl.pathname += import.meta.url.endsWith(".ts") ? ".ts" : ".js";
  return workerUrl.pathname;
}

/**
 * 启动 Leafer 渲染服务
 *
 * @param port - 服务监听端口
 */
export async function startServer(port: number): Promise<void> {
  const app = new App(port, getWorkerPath(), { piscina: { minThreads: 30, maxThreads: 100 } });
  await app.start();
  console.log(`[LeaferEngine] Server started on http://127.0.0.1:${port}`);
}

// 直接运行时启动服务
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const port = Number(process.env.PORT) || 3000;
  startServer(port).catch((err) => {
    console.error("[LeaferEngine] Failed to start:", err);
    process.exit(1);
  });
}
