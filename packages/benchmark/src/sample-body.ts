/**
 * 默认压测请求体 — Fabric 引擎兼容的简单模板
 */
export const DEFAULT_BODY: Record<string, unknown> = {
  options: {
    width: 800,
    height: 600,
    format: "png",
    quantity: 80,
    compressLevel: 6,
  },
  templateJson: {
    version: "5.0.0",
    objects: [
      {
        type: "rect",
        left: 100,
        top: 100,
        width: 200,
        height: 100,
        fill: "#ff0000",
      },
      {
        type: "textbox",
        left: 100,
        top: 250,
        width: 400,
        text: "Hello Benchmark",
        fontSize: 32,
        fill: "#333333",
      },
    ],
  },
  variables: {},
};