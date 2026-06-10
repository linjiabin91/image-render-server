/**
 * Playwright 引擎服务端启动入口
 *
 * 启动 Chromium 无头浏览器，公开 CDP endpoint 供 Worker 连接。
 * 使用通用的 App 挂载本引擎的 Piscina worker，启动 HTTP 服务。
 */
import {chromium} from "playwright";
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
 * 启动 Playwright 渲染服务
 *
 * 1. 启动 Chromium 无头浏览器
 * 2. 获取 CDP endpoint URL
 * 3. 设置 PLAYWRIGHT_BROWSER_ENDPOINT 环境变量
 * 4. 创建 Piscina worker 线程池
 * 5. 启动 HTTP 服务
 *
 * @param port - 服务监听端口
 */
export async function startServer(port: number): Promise<void> {
  // 启动浏览器
  const browser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
    ],
  });

  // 获取 CDP endpoint
  const browserEndpoint = browser.wsEndpoint();
  process.env.PLAYWRIGHT_BROWSER_ENDPOINT = browserEndpoint;

  console.log(`[PlaywrightEngine] Browser launched, CDP endpoint: ${browserEndpoint}`);

  const app = new App(port, getWorkerPath(), {piscina: {minThreads: 30, maxThreads: 100}});
  await app.start();
  console.log(`[PlaywrightEngine] Server started on http://127.0.0.1:${port}`);
}

// 直接运行时启动服务
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const port = Number(process.env.PORT) || 3000;
  startServer(port).catch((err) => {
    console.error("[PlaywrightEngine] Failed to start:", err);
    process.exit(1);
  });
}
