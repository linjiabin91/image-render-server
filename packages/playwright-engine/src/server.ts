/**
 * Playwright 引擎服务端启动入口
 *
 * 启动 Chromium 无头浏览器，公开 CDP endpoint 供 Worker 连接。
 * 使用通用的 App 挂载本引擎的 Piscina worker，启动 HTTP 服务。
 *
 * Worker 通过环境变量 PLAYWRIGHT_BROWSER_ENDPOINT 获取 CDP 连接地址。
 * 由于 Piscina 不支持传递自定义初始化参数，只能通过 process.env 共享。
 */
import {chromium} from "playwright-core";
import {App} from "@image-render-server/server";
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
  // 启动浏览器服务器（launchServer 返回 BrowserServer，通过 WebSocket 暴露 CDP endpoint）
  const browserServer = await chromium.launchServer({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-software-rasterizer",
      "--no-zygote",
      "--disable-extensions",
      "--disable-background-networking",
      "--disable-sync",
      "--disable-translate",
      "--hide-scrollbars",
      '--disable-accelerated-2d-canvas',
      '--disable-background-timer-throttling'
    ],
  });

  // 通过环境变量将 CDP endpoint 传递给 Piscina worker
  const browserEndpoint = browserServer.wsEndpoint();
  process.env.PLAYWRIGHT_BROWSER_ENDPOINT = browserEndpoint;

  console.log(`[PlaywrightEngine] Browser launched, CDP endpoint: ${browserEndpoint}`);

  // 每个 Worker 持有一个 CDP 连接和页面池，线程数不宜过多
  const app = new App(port, getWorkerPath());
  await app.start();
  console.log(`[PlaywrightEngine] Server started on http://127.0.0.1:${port}`);

  // 优雅关闭：收到终止信号时关闭浏览器
  const shutdown = async () => {
    console.log("[PlaywrightEngine] Shutting down...");
    await app.stop().catch(() => {});
    await browserServer.close().catch(() => {});
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

// 直接运行时启动服务
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const port = Number(process.env.PORT) || 3000;
  startServer(port).catch((err) => {
    console.error("[PlaywrightEngine] Failed to start:", err);
    process.exit(1);
  });
}
