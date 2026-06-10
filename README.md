# render-server

基于 Leafer + Fastify 的图片渲染服务。渲染引擎以插件形式扩展，通过 Piscina 线程池隔离。

## 架构

```
render-server/
├── packages/
│   ├── core/                  # 公共类型与接口
│   │   ├── src/types.ts       # RenderOptions、ImageFormat 等基础类型
│   │   ├── src/engine.ts      # Engine 接口（所有引擎必须实现）
│   │   └── fonts/             # 引擎共享的字体资源
│   │
│   ├── server/                # 通用 HTTP 服务
│   │   └── src/app.ts         # App 类：Fastify + Piscina 线程池
│   │                          # 自动注册 POST /api/render
│   │
│   └── leafer-engine/         # Leafer 渲染引擎（实现 Engine 接口）
│       ├── src/leafer.engine.ts   # 纯渲染逻辑，实现 Engine
│       ├── src/render.worker.ts   # Piscina worker 入口
│       └── src/server.ts          # 引擎服务端启动入口
│
├── Dockerfile
└── package.json               # npm workspaces 根配置
```

## 请求链路

```
POST /api/render
  └── App（server/app.ts）
       └── Piscina 线程池
            └── render.worker.ts
                 └── LeaferEngine.render()
                      ├── 预加载图片（@leafer 的 Resource）
                      ├── 渲染到 Leafer 画布
                      └── sharp 编码 → Buffer
```

## 快速开始

```bash
# 安装依赖
npm ci

# 构建
npm run build

# 启动（默认端口 3000）
npm start
# 或指定端口
PORT=8080 npm start

# 测试渲染
curl -X POST http://127.0.0.1:3000/api/render \
  -H "Content-Type: application/json" \
  -d '{
    "options": {
      "width": 2325,
      "height": 3508,
      "format": "png",
      "quantity": 80,
      "compressLevel": 5
    },
    "templateJson": {
      "width": 2325,
      "height": 3508,
      "children": [
        {"tag": "Text", "x": 400, "y": 100, "text": "Hello", "fontSize": 50}
      ]
    },
    "variables": {}
  }'
```

## 请求体格式

```typescript
{
  options: RenderOptions;     // 渲染配置
  templateJson: T;            // 模板 JSON（泛型，由引擎定义）
  variables: Record<string, string>;  // 变量替换映射
}
```

### RenderOptions

| 字段 | 类型 | 说明 |
|------|------|------|
| width | number | 输出图片宽度（像素） |
| height | number | 输出图片高度（像素） |
| format | "png" \| "jpeg" | 输出图片格式 |
| quantity | Quantity | 输出图片数量（0-100 整数） |
| compressLevel | CompressLevel | 压缩级别（0-10 整数） |

## 扩展引擎

### 1. 实现 Engine 接口

```typescript
import { type Engine, type RenderOptions } from "@render-server/core";

class MyEngine implements Engine {
  async init(): Promise<void> { /* 初始化资源 */ }

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

### 2. 编写 Piscina worker

```typescript
// packages/my-engine/src/render.worker.ts
import { MyEngine } from "./my.engine.js";

const engine = new MyEngine();
await engine.init();

export default function render(params: MyRenderParams): Promise<Buffer> {
  return engine.render(params);
}
```

### 3. 创建 server.ts

```typescript
import { App } from "@render-server/server";

export async function startServer(port: number): Promise<void> {
  const app = new App(port, new URL("render.worker.js", import.meta.url).pathname);
  await app.start();
}
```

## Docker

```bash
docker build -t render-server .
docker run -p 3000:3000 render-server
```
