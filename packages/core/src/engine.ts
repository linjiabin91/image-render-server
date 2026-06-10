import type { RenderOptions } from "./types.js";

/** 引擎接口，所有渲染引擎需实现此接口 */
export interface Engine<T = Record<string, unknown>> {
  /**
   * 执行渲染
   * @param params - 渲染参数
   *   - options: 渲染配置（宽高/格式/压缩等）
   *   - templateJson: 模板 JSON 结构（泛型，由具体引擎定义）
   *   - variables: 变量替换映射
   * @returns 渲染结果图片的 Buffer
   */
  render(params: {
    options: RenderOptions;
    templateJson: T;
    variables: Record<string, string>;
  }): Promise<Buffer>;

  /** 初始化引擎（异步） */
  init(): Promise<void>;

  /** 销毁引擎，释放资源 */
  destroy(): void;
}
