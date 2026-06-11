# render-server

<p>
  <img src="https://img.shields.io/badge/license-MIT-blue" alt="License">
  <img src="https://img.shields.io/badge/node-%3E%3D18-brightgreen" alt="Node">
  <img src="https://img.shields.io/badge/pnpm-8.4.0-orange" alt="pnpm">
  <img src="https://img.shields.io/badge/TypeScript-6.0-3178C6" alt="TypeScript">
</p>

基于多种渲染引擎的图片渲染服务。通过 Piscina 线程池隔离，支持模板 JSON 驱动的场景图渲染。

## 架构

```
render-server/
├── packages/
│   ├── core/                      # 公共类型与接口
│   │   ├── src/types.ts           # RenderOptions、ImageFormat 等
│   │   ├── src/engine.ts          # Engine 接口
│   │   ├── src/resolve-variables.ts  # {{key}} 变量替换
│   │   ├── src/logger.ts          # Pino 日志
│   │   ├── src/perf.ts            # 性能计时器
│   │   └── fonts/                 # 共享字体（AlibabaPuHuiTi）
│   │
│   ├── server/                    # 通用 HTTP 服务
│   │   └── src/app.ts             # Fastify + Piscina 线程池 + 速率限制
│   │
│   ├── leafer-engine/             # Leafer 渲染引擎
│   │   └── src/
│   │       ├── leafer.engine.ts   # @leafer-ui/node 渲染
│   │       ├── render.worker.ts
│   │       └── server.ts
│   │
│   ├── fabric5-engine/            # Fabric.js 5 渲染引擎
│   │   └── src/
│   │       ├── fabric.engine.ts   # fabric@5 + skia-canvas
│   │       ├── render.worker.ts
│   │       └── server.ts
│   │
│   ├── fabric-engine/             # Fabric.js 7 渲染引擎
│   │   └── ...
│   │
│   ├── playwright-engine/         # Playwright 无头浏览器渲染引擎
│   │   └── src/
│   │       ├── playwright.engine.ts  # Chromium 截图
│   │       ├── pages/               # 各引擎的浏览器渲染页面
│   │       │   ├── leafer_2.1.4.html
│   │       │   ├── fabric_5.5.2.html
│   │       │   ├── fabric_7.4.0.html
│   │       │   └── konva_9.3.0.html
│   │       ├── render.worker.ts
│   │       └── server.ts
│   │
│   └── konva-engine/              # Konva 渲染引擎（新增）
│       └── src/
│           ├── konva.engine.ts    # konva + @napi-rs/canvas
│           ├── render.worker.ts
│           └── server.ts
│
├── Dockerfile
└── package.json                   # npm workspaces
```

## 引擎对比

| 引擎 | 模式 | 底层渲染 | 模板格式 | 智能更新 |
|------|------|----------|----------|----------|
| leafer | Node.js | @leafer-ui/node + @napi-rs/canvas | tag 标识节点, url 标识图片 | text/url 增量 |
| fabric5 | Node.js | fabric@5 + skia-canvas | type/objects 数组 | text/src 增量 |
| fabric7 | Node.js | fabric@7 | 同上 | 同上 |
| playwright | 浏览器 | Chromium + page.screenshot() | 动态加载各引擎 HTML 页面 | 页面内增量 |
| konva | Node.js | konva + @napi-rs/canvas | tag/className 标识, url/image 标识图片 | text/image 增量 |

## 请求链路

```
POST /api/render
  └── App（packages/server）
       └── Piscina 线程池（max(2, cpu-2) 线程）
            └── render.worker.ts（引擎 Worker）
                 └── Engine.render()
                      ├── resolveVariables()  — {{key}} 替换
                      ├── MD5 缓存键计算
                      ├── LRU 池命中/未命中
                      │   ├── HIT:  smartUpdate()  — 增量更新
                      │   └── MISS: preloadImages → 全量重建
                      ├── 渲染到画布
                      ├── PNG:  getImageData + @napi-rs/image 编码
                      └── 其他:  canvas.toBuffer() → Buffer
```

## 快速开始

```bash
# 安装依赖
npm ci

# 构建所有包
npm run build

# 启动引擎

## Leafer（默认，端口 3000）
npm start

## Fabric 5
cd packages/fabric5-engine && npm start

## Konva（端口 3000）
npm run start:konva

## Playwright（需先启动 Chromium）
cd packages/playwright-engine && npm start
```

### 测试渲染

```bash
curl -X POST http://127.0.0.1:3000/api/render \
  -H "Content-Type: application/json" \
  -d '{
    "options": {
      "width": 800,
      "height": 600,
      "format": "png",
      "compressLevel": 0
    },
    "templateJson": {
      "width": 800,
      "height": 600,
      "children": [
        {"tag": "Text", "x": 100, "y": 100, "text": "Hello", "fontSize": 50, "fill": "#333"},
        {"tag": "Image", "x": 100, "y": 200, "width": 200, "height": 200, "url": "https://example.com/image.png"}
      ]
    },
    "variables": {}
  }'
```

## 请求体格式

```typescript
{
  options: RenderOptions;
  templateJson: T;                         // 模板 JSON（泛型，由引擎定义）
  variables: Record<string, string>;       // {{key}} 变量替换映射
}
```

### RenderOptions

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| width | number | — | 输出图片宽度（像素） |
| height | number | — | 输出图片高度（像素） |
| format | "png" \| "jpeg" \| "jpg" \| "webp" | — | 输出图片格式 |
| quantity | Quantity (0-100) | — | 图片质量 |
| compressLevel | CompressLevel (0-10) | 0 | PNG 压缩级别 |
| pixelRatio | number | 1 | 像素倍率（2 = 2x 高清） |
| engine | string | — | 引擎标识（leafer/fabric5/playwright/konva） |
| version | string | — | 引擎版本/模板版本 |

### 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `3000` | 服务监听端口 |
| `LOG_LEVEL` | `info` | Pino 日志级别（trace/debug/info/warn/error/fatal） |
| `LOG_PRETTY` | 未设置 | 设为 `true` 启用 pino-pretty 格式化日志输出（开发用） |
| `IMAGE_FETCH_TIMEOUT` | `10000` | 图片下载超时（毫秒） |

## 模板格式

### Leafer / Konva 格式（tag 标识）

```json
{
  "width": 800,
  "height": 600,
  "children": [
    {
      "tag": "Text",
      "x": 100, "y": 100,
      "text": "Hello",
      "fontSize": 50,
      "fontFamily": "AlibabaPuHuiTi-3-45-Light",
      "fill": "#333"
    },
    {
      "tag": "Image",
      "x": 100, "y": 200,
      "width": 200, "height": 200,
      "url": "https://example.com/image.png"
    },
    {
      "tag": "Group",
      "x": 0, "y": 0,
      "children": [
        { "tag": "Text", "text": "nested", "fontSize": 20 }
      ]
    }
  ]
}
```

### Fabric 格式

```json
{
  "version": "5.0.0",
  "background": "#fff",
  "objects": [
    {
      "type": "i-text",
      "text": "Hello",
      "left": 100, "top": 100,
      "fontSize": 50,
      "fill": "#333"
    },
    {
      "type": "image",
      "src": "https://example.com/image.png",
      "left": 100, "top": 200
    }
  ]
}
```

### 兼容性说明

Konva 引擎同时兼容两种标识方式：
- **类型标识**：`tag`（leafer 格式）或 `className`（fabric 格式）
- **图片来源**：`url`（leafer）、`image`（fabric）、`fill.url`（fill 填充）

## 当前引擎

| 包 | 引擎 | 模板格式 | 状态 |
|----|------|----------|------|
| `packages/leafer-engine` | Leafer 2.1.4 | LeaferTemplateJson (tag + url) | 生产 |
| `packages/fabric5-engine` | Fabric 5.5.2 | FabricTemplateJson (type + src) | 生产 |
| `packages/fabric-engine` | Fabric 7.x | FabricTemplateJson | 开发 |
| `packages/playwright-engine` | Playwright Chromium | 动态（由 engine/version 决定） | 生产 |
| `packages/konva-engine` | Konva 9.3.0 | KonvaTemplateJson (tag/className + url/image) | 新增 |

### Playwright 引擎

Playwright 引擎通过 `engine` 和 `version` 选项动态选择 HTML 页面：

```
options.engine = "konva"    → pages/konva_9.3.0.html
options.version = "9.3.0"   → library at pages/konva/9.3.0/konva.min.js
```

引擎在浏览器中加载 HTML 页面，调用页面的 `draw({options, templateJson, cacheKey})` 函数渲染，然后 `page.screenshot()` 输出。

### Konva 引擎

Konva 引擎支持完整的场景图渲染：
- **Text** — fontSize、fontFamily、fill 颜色
- **Image** — 预加载 + 缓存，image/url/fill.url 三种来源
- **Group/Layer** — 递归嵌套子节点
- **Smart Update** — 按数组索引匹配，增量更新 text/image 属性
- **Canvas 池** — LRU 淘汰，上限 10 实例
- **图片缓存** — 进程内 Map，10 秒超时

## 性能

每个 Worker 持有独立的引擎实例：
- **leafer/fabric/konva**：LRU 画布池 + MD5 缓存键 + 智能更新
- **playwright**：LRU 页面池 + 按模板 MD5 复用页面

PNG 输出统一走 `getImageData` + `@napi-rs/image` 编码，提供 0-10 压缩级别控制。

## 扩展引擎

### 1. 实现 Engine 接口

```typescript
import { type Engine, type RenderOptions } from "@render-server/core";

class MyEngine implements Engine {
  async init(): Promise<void> { /* 初始化 */ }

  async render(params: {
    options: RenderOptions;
    templateJson: MyTemplate;
    variables: Record<string, string>;
  }): Promise<Buffer> {
    // 渲染逻辑
  }

  destroy(): void { /* 释放资源 */ }
}
```

### 2. 编写 Piscina worker + server

```typescript
// packages/my-engine/src/render.worker.ts
import { MyEngine } from "./my.engine.js";

const engine = new MyEngine();
await engine.init();

export default function render(params: MyRenderParams): Promise<Buffer> {
  return engine.render(params);
}
```

```typescript
// packages/my-engine/src/server.ts
import { App } from "@render-server/server";
export async function startServer(port: number): Promise<void> {
  const app = new App(port, new URL("render.worker.js", import.meta.url).pathname);
  await app.start();
}
```

### 3. 注册到根配置

```bash
# package.json — build 命令追加新包
"build": "tsc -b packages/core packages/server ... packages/my-engine"

# package.json — 新增启动脚本
"start:my": "node packages/my-engine/dist/server.js"
```

## Docker

每个引擎的包目录下有独立的 Dockerfile，多阶段构建（builder → runtime），仅打包引擎自身代码。

```bash
# Leafer（默认）
docker build -t render-server:leafer -f packages/leafer-engine/Dockerfile .
docker run -p 3000:3000 render-server:leafer

# Fabric 5
docker build -t render-server:fabric5 -f packages/fabric5-engine/Dockerfile .
docker run -p 3000:3000 render-server:fabric5

# Fabric 7
docker build -t render-server:fabric -f packages/fabric-engine/Dockerfile .
docker run -p 3000:3000 render-server:fabric

# Playwright（含 Chromium）
docker build -t render-server:playwright -f packages/playwright-engine/Dockerfile .
docker run -p 3000:3000 render-server:playwright

# Konva
docker build -t render-server:konva -f packages/konva-engine/Dockerfile .
docker run -p 3000:3000 render-server:konva
```

### Dockerfile 说明

- **多阶段构建**：builder 阶段安装编译工具（python3, make, g++）编译原生模块（@napi-rs/canvas、skia-canvas），runtime 阶段只保留 libc6-compat
- **依赖缓存**：先复制所有 package.json 执行 `npm ci`，利用 Docker 层缓存加速重复构建
- **Workspace 兼容**：复制全部 engine 的 package.json 以满足 npm workspaces 解析，但仅复制目标引擎源码
- **Playwright**：runtime 镜像安装 chromium 系统包，通过 `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` 跳过浏览器下载
