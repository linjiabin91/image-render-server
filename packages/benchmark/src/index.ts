/**
 * @render-server/benchmark — HTTP 压测工具
 *
 * 基于 autocannon 对渲染服务的 POST /api/render 接口进行压力测试。
 *
 * 用法：
 *   node dist/index.js
 *   node dist/index.js --connections 10 --amount 500
 *   node dist/index.js --url http://other-host:4000/api/render
 *   node dist/index.js --body ./custom-body.json
 *   node dist/index.js --body-json '{"options":{"width":400}}'
 *   node dist/index.js --duration 30
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import autocannon, { type Result } from "autocannon";
import { DEFAULT_BODY } from "./sample-body.js";

/* ------------------------------------------------------------------ */
/*  CLI 参数解析                                                        */
/* ------------------------------------------------------------------ */

interface CliArgs {
  url: string;
  connections: number;
  amount: number;
  duration: number; // seconds, 0 = use amount mode
  method: autocannon.Options["method"];
  bodyPath: string | null;
  bodyJson: string | null;
  headers: Record<string, string>;
  help: boolean;
}

function parseArgs(): CliArgs {
  const raw = process.argv.slice(2);

  const args: CliArgs = {
    url: "http://localhost:3000/api/render",
    connections: 20,
    amount: 100,
    duration: 0,
    method: "POST",
    bodyPath: null,
    bodyJson: null,
    headers: {},
    help: false,
  };

  for (let i = 0; i < raw.length; i++) {
    const arg = raw[i];

    switch (arg) {
      case "--url":
      case "-u":
        args.url = raw[++i];
        break;
      case "--connections":
      case "-c":
        args.connections = Number.parseInt(raw[++i], 10);
        break;
      case "--amount":
      case "-a":
        args.amount = Number.parseInt(raw[++i], 10);
        break;
      case "--duration":
      case "-d":
        args.duration = Number.parseFloat(raw[++i]);
        args.amount = 0; // amount 为 0 时会使用 duration 模式
        break;
      case "--method":
      case "-m":
        args.method = raw[++i].toUpperCase() as autocannon.Options["method"];
        break;
      case "--body":
      case "-b":
        args.bodyPath = raw[++i];
        break;
      case "--body-json":
      case "-j":
        args.bodyJson = raw[++i];
        break;
      case "--headers":
      case "-H":
        try {
          args.headers = { ...args.headers, ...JSON.parse(raw[++i]) };
        } catch {
          console.error("❌ --headers 参数必须是有效的 JSON 对象字符串");
          process.exit(1);
        }
        break;
      case "--help":
      case "-h":
        args.help = true;
        break;
      default:
        console.error(`未知参数: ${arg}`);
        args.help = true;
        break;
    }
  }

  return args;
}

function printHelp(): void {
  console.log(`
  @render-server/benchmark — 渲染服务 HTTP 压测工具

  用法:
    node dist/index.js [选项]

  选项:
    --url, -u           请求地址                  (默认: http://localhost:3000/api/render)
    --connections, -c   并发连接数                (默认: 20)
    --amount, -a        总请求数                  (默认: 100)
    --duration, -d      持续测试秒数 (与 --amount 互斥)  (默认: 0, 使用 amount 模式)
    --method, -m        HTTP 方法                (默认: POST)
    --body, -b          请求体 JSON 文件路径       (默认: 内置简单模板)
    --body-json, -j     请求体 JSON 字符串         (优先级高于 --body)
    --headers, -H       自定义请求头 JSON 字符串   (例如: '{"Authorization":"Bearer xxx"}')
    --help, -h          显示此帮助信息

  示例:
    node dist/index.js
    node dist/index.js -c 10 -a 500
    node dist/index.js -d 30 -c 50
    node dist/index.js --body ./custom-body.json
    node dist/index.js -j '{"options":{"width":400,"format":"jpeg"},"templateJson":{"version":"5.0.0","objects":[]},"variables":{}}'
    node dist/index.js -u http://localhost:4000/api/render
`);
}

/* ------------------------------------------------------------------ */
/*  构建请求体                                                          */
/* ------------------------------------------------------------------ */

function buildBody(args: CliArgs): string {
  // 1) 内联 JSON 字符串优先级最高
  if (args.bodyJson) {
    try {
      JSON.parse(args.bodyJson);
      return args.bodyJson;
    } catch {
      console.error("❌ --body-json 不是有效的 JSON");
      process.exit(1);
    }
  }

  // 2) 从文件读取
  if (args.bodyPath) {
    const absPath = resolve(args.bodyPath);
    if (!existsSync(absPath)) {
      console.error(`❌ 请求体文件不存在: ${absPath}`);
      process.exit(1);
    }
    return readFileSync(absPath, "utf-8");
  }

  // 3) 默认内置模板
  return JSON.stringify(DEFAULT_BODY);
}

/* ------------------------------------------------------------------ */
/*  压测入口                                                           */
/* ------------------------------------------------------------------ */

async function runBenchmark(args: CliArgs): Promise<void> {
  const body = buildBody(args);
  const autocannonOpts: autocannon.Options = {
    url: args.url,
    connections: args.connections,
    method: args.method,
    headers: {
      "Content-Type": "application/json",
      ...args.headers,
    },
    body,
  };

  // amount > 0 → 固定请求数模式；否则按 duration 跑
  if (args.amount > 0) {
    autocannonOpts.amount = args.amount;
  } else if (args.duration > 0) {
    autocannonOpts.duration = args.duration;
  } else {
    // 兜底：amount 100
    autocannonOpts.amount = 100;
  }

  console.log("\n╔══════════════════════════════════════════════╗");
  console.log("║       渲染服务 HTTP 压力测试                    ║");
  console.log("╚══════════════════════════════════════════════╝\n");
  console.log(`  目标地址:    ${args.url}`);
  console.log(`  方法:        ${args.method}`);
  console.log(`  并发连接:    ${args.connections}`);
  if (args.amount > 0) {
    console.log(`  总请求数:    ${args.amount}`);
  } else {
    console.log(`  持续时间:    ${args.duration}s`);
  }
  console.log(`  请求体大小:  ${(Buffer.byteLength(body) / 1024).toFixed(1)} KB`);
  console.log("");

  return new Promise((resolvePromise, reject) => {
    const instance = autocannon(autocannonOpts, (err: Error | null, result: Result) => {
      if (err) {
        reject(err);
        return;
      }

      printResults(result);
      resolvePromise();
    });

    // 实时进度条
    autocannon.track(instance, { renderProgressBar: true });
  });
}

/* ------------------------------------------------------------------ */
/*  结果输出                                                           */
/* ------------------------------------------------------------------ */

function printResults(result: Result): void {
  const { requests, latency, throughput, errors, timeouts, non2xx } = result;

  // 收集有值的状态码分布
  const statusEntries: Array<[string, number]> = [];
  for (const key of ["1XX", "2XX", "3XX", "4XX", "5XX"] as const) {
    const count = result[key];
    if (count > 0) {
      statusEntries.push([key.replace("XX", "xx"), count]);
    }
  }
  const statusSummary = statusEntries
    .map(([code, count]) => `    ${code}: ${count}`)
    .join("\n");

  console.log("\n\n┌──────────────────────────────────────────────┐");
  console.log("│                 压测结果                      │");
  console.log("└──────────────────────────────────────────────┘\n");

  console.log("  请求统计:");
  console.log(`    总请求数:    ${requests.total}`);
  console.log(`    发送成功:    ${requests.sent ?? 0}`);
  console.log(`    每秒请求:    ${(requests.average ?? 0).toFixed(1)} req/s`);
  console.log(`    总耗时:      ${(result.duration ?? 0).toFixed(2)}s`);

  if (statusSummary) {
    console.log(`  状态码分布:\n${statusSummary}`);
  }

  console.log("  延迟 (ms):");
  console.log(`    平均值:      ${(latency.average ?? 0).toFixed(2)}`);
  console.log(`    最小值:      ${(latency.min ?? 0).toFixed(2)}`);
  console.log(`    最大值:      ${(latency.max ?? 0).toFixed(2)}`);
  console.log(`    p50:         ${(latency.p50 ?? 0).toFixed(2)}`);
  console.log(`    p75:         ${(latency.p75 ?? 0).toFixed(2)}`);
  console.log(`    p90:         ${(latency.p90 ?? 0).toFixed(2)}`);
  console.log(`    p99:         ${(latency.p99 ?? 0).toFixed(2)}`);

  console.log("  吞吐量:");
  console.log(`    平均值:      ${formatBytes(throughput.average ?? 0)}/s`);
  console.log(`    总计:        ${formatBytes(throughput.total ?? 0)}`);

  const totalErrors = (errors ?? 0) + (timeouts ?? 0) + (non2xx ?? 0);
  if (totalErrors > 0) {
    console.log("  ⚠ 错误:");
    if (errors) console.log(`    连接错误:    ${errors}`);
    if (timeouts) console.log(`    超时:        ${timeouts}`);
    if (non2xx) console.log(`    非 2xx 响应: ${non2xx}`);
  }

  console.log("");
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${bytes.toFixed(0)} B`;
}

/* ------------------------------------------------------------------ */
/*  入口                                                               */
/* ------------------------------------------------------------------ */

function main(): void {
  const args = parseArgs();

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  runBenchmark(args).catch((err) => {
    console.error("\n❌ 压测执行失败:", err.message);
    process.exit(1);
  });
}

main();