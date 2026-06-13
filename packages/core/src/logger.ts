import pino from "pino";
import { isMainThread } from "node:worker_threads";

/**
 * 全局共享的 Pino 日志实例
 *
 * - HTTP 请求日志由 Fastify 的 `{ logger: true }` 自动处理
 * - 业务日志统一用此实例，保证 JSON 格式一致
 * - 在 Piscina Worker 中自动启用同步模式，防止日志丢失
 * - 设置环境变量 `LOG_PRETTY=true` 启用 pino-pretty 格式化（仅主线程）
 *
 * 用法：
 * ```ts
 * import { logger } from "@image-render-server/core";
 * logger.info("service started");
 * logger.error({ err }, "render failed");
 * logger.warn({ url }, "image load timeout");
 * ```
 */

async function createLogger(): Promise<pino.Logger> {
  if (process.env.LOG_PRETTY === "true") {
    const pretty = await import("pino-pretty");
    return pino(
      { level: process.env.LOG_LEVEL ?? "info" },
      pretty.default({ colorize: true }),
    );
  }

  const dest = pino.destination({ sync: !isMainThread });
  return pino(
    { level: process.env.LOG_LEVEL ?? "info" },
    dest,
  );
}

export const logger = await createLogger();

