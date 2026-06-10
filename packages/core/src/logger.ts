import pino from "pino";
import { isMainThread } from "node:worker_threads";

/**
 * 全局共享的 Pino 日志实例
 *
 * - HTTP 请求日志由 Fastify 的 `{ logger: true }` 自动处理
 * - 业务日志统一用此实例，保证 JSON 格式一致
 * - 在 Piscina Worker 中自动启用同步模式，防止日志丢失
 *
 * 用法：
 * ```ts
 * import { logger } from "@render-server/core";
 * logger.info("service started");
 * logger.error({ err }, "render failed");
 * logger.warn({ url }, "image load timeout");
 * ```
 */
const dest = pino.destination({ sync: !isMainThread });

export const logger = pino(
  { level: process.env.LOG_LEVEL ?? "info" },
  dest,
);

