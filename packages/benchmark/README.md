# @image-render-server/benchmark

基于 [autocannon](https://github.com/mcollina/autocannon) 的 HTTP 压力测试工具，专为渲染服务的 `POST /api/render` 接口设计。

## 用法

```bash
# 构建
pnpm --filter @image-render-server/benchmark build

# 默认压测：20 并发，100 请求，POST http://localhost:3000/api/render
pnpm benchmark

# 查看更多选项
pnpm benchmark -- --help
```

## CLI 选项

| 选项 | 简写 | 默认值 | 说明 |
|------|------|--------|------|
| `--url` | `-u` | `http://localhost:3000/api/render` | 目标地址 |
| `--connections` | `-c` | `20` | 并发连接数 |
| `--amount` | `-a` | `100` | 总请求数（与 `--duration` 互斥） |
| `--duration` | `-d` | `0` | 持续测试秒数，设置后忽略 `--amount` |
| `--method` | `-m` | `POST` | HTTP 方法 |
| `--body` | `-b` | 内置简单模板 | 请求体 JSON 文件路径 |
| `--body-json` | `-j` | - | 内联请求体 JSON 字符串（优先级高于 `--body`） |
| `--headers` | `-H` | `{}` | 自定义请求头，JSON 字符串格式 |
| `--help` | `-h` | - | 显示帮助信息 |

## 示例

```bash
# 50 并发，500 请求
pnpm benchmark -- -c 50 -a 500

# 持续压测 30 秒，100 并发
pnpm benchmark -- -d 30 -c 100

# 指定其他地址
pnpm benchmark -- -u http://localhost:4000/api/render

# 使用自定义请求体文件
pnpm benchmark -- --body ./my-template.json

# 内联请求体（覆盖默认）
pnpm benchmark -- -j '{"options":{"width":400},"templateJson":{"version":"5.0.0","objects":[]},"variables":{}}'

# 自定义请求头
pnpm benchmark -- -H '{"Authorization":"Bearer test123"}'
```

## 默认请求体

内置的默认请求体是一个 Fabric 引擎兼容的简单模板，包含一个红色矩形和一段文字，格式为 800×600 PNG。

## 输出说明

压测完成后会输出：
- **请求统计** — 总请求数、发送成功数、每秒请求数 (QPS)、总耗时
- **状态码分布** — 各 HTTP 状态码的数量
- **延迟** — 平均/最小/最大延迟，以及 p50/p75/p90/p99 百分位
- **吞吐量** — 平均每秒吞吐量和总计
- **错误** — 连接错误、超时、非 2xx 响应（如有）