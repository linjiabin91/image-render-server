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
│   │   └── src/
│   │       ├── fabric.engine.ts   # fabric@7 + skia-canvas
│   │       ├── render.worker.ts
│   │       └── server.ts
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
│   └── konva-engine/              # Konva 渲染引擎
│       └── src/
│           ├── konva.engine.ts    # konva + @napi-rs/canvas
│           ├── render.worker.ts
│           └── server.ts
│
├── docker-compose.yml
├── eslint.config.js
├── vitest.config.ts
├── pnpm-workspace.yaml
└── package.json
```

## 引擎介绍

### [Leafer](https://leaferjs.com/) — `packages/leafer-engine`

国产高性能 Canvas 2D 渲染引擎，专为图形编辑场景设计。Node.js 端通过 `@leafer-ui/node` 运行。

- **官网**：[https://leaferjs.com](https://leaferjs.com)
- **GitHub**：[https://github.com/leaferjs/leafer](https://github.com/leaferjs/leafer)
- **模板格式**：LeaferTemplateJson（tag + url 标识节点和图片来源）

### [Fabric.js](http://fabricjs.com/) — `packages/fabric5-engine` / `packages/fabric-engine`

老牌 Canvas 库，生态成熟。本服务同时支持 Fabric 5.5.2 和 Fabric 7.x 两个版本。

- **官网**：[http://fabricjs.com](http://fabricjs.com)
- **文档**：[http://fabricjs.com/docs](http://fabricjs.com/docs)
- **GitHub**：[https://github.com/fabricjs/fabric.js](https://github.com/fabricjs/fabric.js)
- **模板格式**：FabricTemplateJson（type + objects 数组结构）

### [Konva](https://konvajs.org/) — `packages/konva-engine`

桌面级 Canvas 2D 框架，API 设计简洁，适合场景图渲染。Node.js 端通过 `@napi-rs/canvas` 运行。

- **官网**：[https://konvajs.org](https://konvajs.org)
- **文档**：[https://konvajs.org/docs](https://konvajs.org/docs)
- **GitHub**：[https://github.com/konvajs/konva](https://github.com/konvajs/konva)
- **模板格式**：KonvaTemplateJson（兼容 tag 和 className 两种标识）

### [Playwright](https://playwright.dev/) — `packages/playwright-engine`

微软出品的无头浏览器自动化框架。本服务通过 Playwright 控制 Chromium 加载各引擎的 HTML 页面并截图输出。

- **官网**：[https://playwright.dev](https://playwright.dev)
- **文档**：[https://playwright.dev/docs](https://playwright.dev/docs)
- **GitHub**：[https://github.com/microsoft/playwright](https://github.com/microsoft/playwright)
- **模板格式**：动态选择（由 `options.engine` + `options.version` 决定加载哪个 HTML 页面）

## 引擎对比

| 引擎 | 模式 | 底层渲染 | 模板格式 | 智能更新 |
|------|------|----------|----------|----------|
| leafer | Node.js | @leafer-ui/node + @napi-rs/canvas | tag 标识节点, url 标识图片 | text/url 增量 |
| fabric5 | Node.js | fabric@5 + skia-canvas | type/objects 数组 | text/src 增量 |
| fabric7 | Node.js | fabric@7 + skia-canvas | type/objects 数组 | text/src 增量 |
| playwright | 浏览器 | Chromium + page.screenshot() | 动态加载各引擎 HTML 页面 | 页面内增量 |
| konva | Node.js | konva + @napi-rs/canvas | tag/className 标识, url/image 标识图片 | text/image 增量 |

## 字体管理

服务内置**阿里巴巴普惠体 3（AlibabaPuHuiTi-3）**，提供 9 个字重（Thin 35 ~ Black 115）。

字体文件集中存储在 `packages/core/fonts/`。

### 文件名约定

字体注册器通过文件名自动推断族名和字重：

```
AlibabaPuHuiTi-3-45-Light.ttf
└─── 族名 ──┘↑└─ 描述 ─┘
             字重
```

`{familyPrefix}-{weightIndex}-{weightName}.ttf` → `family=AlibabaPuHuiTi-3`, `weight=45`

### 添加自定义字体

在 `packages/core/fonts/` 下按约定命名放置 `.ttf` 或 `.otf` 文件即可，重启后自动生效。

### 环境变量 `FONTS_DIR`

默认字体目录为相对于引擎包的 `../../core/fonts`。如需使用外部字体目录：

```bash
FONTS_DIR=/data/custom-fonts node packages/fabric-engine/dist/server.js
```

`FONTS_DIR` 为绝对路径，设置后将完全替代默认路径，引擎不再扫描 `core/fonts/`。

### FontRegistry 接口

各实现类位于引擎包内的独立文件中：

| 文件 | 实现类 | 后端 |
|------|--------|------|
| `packages/fabric-engine/src/skia-font-registry.ts` | `SkiaFontRegistry` | skia-canvas `FontLibrary.use()` |
| `packages/fabric5-engine/src/fabric5-skia-font-registry.ts` | `Fabric5SkiaFontRegistry` | skia-canvas `FontLibrary.use()` |
| `packages/konva-engine/src/napi-canvas-font-registry.ts` | `NapiCanvasFontRegistry` | @napi-rs/canvas `GlobalFonts.registerFromPath()` |
| `packages/leafer-engine/src/leafer-napi-canvas-font-registry.ts` | `LeaferNapiCanvasFontRegistry` | @napi-rs/canvas `GlobalFonts.registerFromPath()` |

Playwright 引擎的字体注册通过 HTML 页面的 CSS `@font-face` 实现，不经过 FontRegistry 接口。

引擎模块顶层自动调用 `autoRegisterFonts()`，用户无需手动初始化。

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
pnpm install

# 构建所有包
pnpm run build

# 运行所有测试
pnpm run test

# 启动引擎

## Leafer（默认，端口 3000）
pnpm start

## Fabric 5
cd packages/fabric5-engine && pnpm start

## Konva（端口 3000）
pnpm run start:konva

## Playwright（需先启动 Chromium）
cd packages/playwright-engine && pnpm start
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
| `FONTS_DIR` | 见字体管理 | 字体目录绝对路径，覆盖引擎默认的字体扫描路径 |

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

## Playwright 引擎

Playwright 引擎通过 `engine` 和 `version` 选项动态选择 HTML 页面：

```
options.engine = "konva"    → pages/konva_9.3.0.html
options.version = "9.3.0"   → library at pages/konva/9.3.0/konva.min.js
```

引擎在浏览器中加载 HTML 页面，调用页面的 `draw({options, templateJson, cacheKey})` 函数渲染，然后 `page.screenshot()` 输出。

支持的页面矩阵：

| engine | version | HTML 页面 |
|--------|---------|-----------|
| leafer | 2.1.4 | `leafer_2.1.4.html` |
| fabric5 | 5.5.2 | `fabric_5.5.2.html` |
| fabric7 | 7.4.0 | `fabric_7.4.0.html` |
| konva | 9.3.0 | `konva_9.3.0.html` |

## 性能

每个 Worker 持有独立的引擎实例：
- Node.js 引擎（leafer/fabric/konva）：LRU 画布池 + MD5 缓存键 + 智能更新
- Playwright 引擎：LRU 页面池 + 按模板 MD5 复用页面

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

# 使用自定义字体目录（挂载卷 + 环境变量）
docker run -p 3000:3000 \
  -v /host/custom-fonts:/data/fonts \
  -e FONTS_DIR=/data/fonts \
  render-server:leafer

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

### Docker-compose（本地开发）

```bash
docker compose up -d <service>
# 可选服务: leafer, fabric5, fabric, playwright, konva
# 端口映射: leafer=3000, fabric5=3001, fabric=3002, playwright=3003, konva=3004
```

## Kubernetes

项目使用 Kustomize 管理 K8s 配置。`k8s/` 目录结构：

```
k8s/
├── base/                          # 通用模板
│   ├── kustomization.yaml
│   ├── configmap.yaml             # 日志级别、图片超时等
│   ├── deployment.yaml            # 部署（2 副本 + 探针 + 资源限制）
│   ├── service.yaml               # ClusterIP 服务
│   └── hpa.yaml                   # 自动扩缩容（CPU 70%，2-10 副本）
└── overlays/                      # 各引擎一行配置切换
    ├── leafer/kustomization.yaml
    ├── fabric5/kustomization.yaml
    ├── fabric/kustomization.yaml
    ├── playwright/kustomization.yaml
    └── konva/kustomization.yaml
```

使用方式：

```bash
# 1. 构建并推送镜像（先修改 overlay 中的 registry 地址）
docker build -t registry/render-server:leafer -f packages/leafer-engine/Dockerfile .
docker push registry/render-server:leafer

# 2. 部署指定引擎
kubectl apply -k k8s/overlays/leafer/

# 3. 多个引擎可同时运行（namePrefix 避免资源名冲突）
kubectl apply -k k8s/overlays/leafer/
kubectl apply -k k8s/overlays/konva/

# 4. 查看生成的完整 YAML
kubectl kustomize k8s/overlays/leafer/

# 5. 扩容（手动调整副本数）
kubectl scale deployment leafer-render-server --replicas=5
```

每个 overlay 只比 base 多三行配置，修改镜像地址只需要改一处：

```yaml
# k8s/overlays/leafer/kustomization.yaml
images:
  - name: render-server
    newName: registry/render-server    # 改成你的镜像仓库
    newTag: leafer                      # 改成你的镜像 tag
```

### Dockerfile 说明

- **多阶段构建**：builder 阶段安装编译工具（python3, make, g++）编译原生模块（@napi-rs/canvas、skia-canvas），runtime 阶段只保留运行时依赖
- **依赖缓存**：先复制所有 package.json 执行 `pnpm install`，利用 Docker 层缓存加速重复构建
- **Workspace 兼容**：复制全部 engine 的 package.json 以满足 pnpm workspaces 解析，但仅复制目标引擎源码
- **镜像加速**：默认使用国内加速源（daocloud + aliyun），境外 CI 通过 `--build-arg BASE_IMAGE=node:23-slim --build-arg DEBIAN_MIRROR=deb.debian.org` 切换官方源
- **Playwright**：runtime 使用微软官方 `mcr.microsoft.com/playwright` 镜像，预装 Chromium/WebKit/Firefox 及所有系统依赖
