import Fastify from "fastify";
import rateLimit from "@fastify/rate-limit";
import underPressure from "@fastify/under-pressure";
import PiscinaModule from "piscina";
import { resolve } from "node:path";
import * as os from "node:os";

interface PiscinaInstance {
  run(task: unknown): Promise<unknown>;
  destroy(): Promise<void>;
}

const Piscina = PiscinaModule as unknown as new (opts: Record<string, unknown>) => PiscinaInstance;

export interface PiscinaOptions {
  /** Piscina 工作线程的 Node.js 启动参数 */
  execArgv?: string[];
  /** Piscina 最小线程数 */
  minThreads?: number;
  /** Piscina 最大线程数 */
  maxThreads?: number;
  /** 空闲线程超时（毫秒） */
  idleTimeout?: number;
}

export interface AppOptions {
  /** Piscina 线程池配置 */
  piscina?: PiscinaOptions;
  /** IP 限流：每分钟每个 IP 最大请求数（默认 100） */
  maxRequestsPerMinute?: number;
  /** 过载保护：最大事件循环延迟（毫秒，默认 200） */
  maxEventLoopDelay?: number;
  /** 过载保护：最大堆内存占比（默认 0.8） */
  maxHeapUsedBytes?: number;
}

const threads = Math.max(2, os.cpus().length - 2);

export class App {
  #fastify = Fastify({ logger: true });
  #piscina!: PiscinaInstance;

  /**
   * @param port - 服务监听端口
   * @param workJsPath - Piscina 工作线程入口文件路径
   * @param options - 可选配置
   */
  constructor(
    private readonly port: number = 3000,
    workJsPath: string,
    options: AppOptions = {
      piscina: {minThreads: threads, maxThreads: threads},
      maxRequestsPerMinute: 100 * 60,
      maxEventLoopDelay: 200,
      maxHeapUsedBytes: 0.8,
    },
  ) {
    this.#piscina = new Piscina({
      filename: resolve(workJsPath),
      execArgv: ["--experimental-strip-types"],
      ...options?.piscina,
    });
    this.#registerPlugins(options);
    this.#registerRoutes();
  }

  #registerPlugins(options?: AppOptions): void {
    this.#fastify.register(rateLimit, {
      max: options?.maxRequestsPerMinute ?? 50 * 60,
      timeWindow: "1 minute",
    });

    this.#fastify.register(underPressure, {
      maxEventLoopDelay: options?.maxEventLoopDelay ?? 200,
      maxHeapUsedBytes: options?.maxHeapUsedBytes
        ? Math.floor(options.maxHeapUsedBytes)
        : undefined,
      message: "Server is under heavy load, please retry later",
      retryAfter: 30,
    });
  }

  #registerRoutes(): void {
    this.#fastify.post("/api/render", async (request, reply) => {
      const body = request.body as { options?: { format?: string } };
      const format = body?.options?.format;
      const contentType =
        format === "jpeg" || format === "jpg"
          ? "image/jpeg"
          : format === "png"
            ? "image/png"
            : "application/octet-stream";

      const result = (await Promise.race([
        this.#piscina.run(request.body) as Promise<Buffer>,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Render timeout (10s)")), 10_000),
        ),
      ])) as Buffer;
      return reply.type(contentType).send(result);
    });
  }

  /** 启动 HTTP 服务 */
  async start(): Promise<void> {
    await this.#fastify.listen({ port: this.port, host: '0.0.0.0' });
  }

  /** 停止服务，释放线程池资源 */
  async stop(): Promise<void> {
    await this.#fastify.close();
    await this.#piscina.destroy();
  }
}
