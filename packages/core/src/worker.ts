/**
 * Piscina Worker 创建工厂
 *
 * 各引擎的 render.worker.ts 几乎完全相同（new Engine → init → 导出默认渲染函数），
 * 此处封装公共模式，每个 worker 文件只需提供构造函数或已有实例。
 */
import type {Engine} from "./engine.js";

type RenderFunc<TEngine extends Engine> = (params: Parameters<TEngine['render']>[0]) => Promise<Buffer>;

/**
 * 创建渲染 Worker 的默认导出函数
 *
 * Piscina 自动调用模块的 default export 作为 worker 入口函数。
 * 支持两种传参方式：
 * - **构造函数**：适用于 fabric、fabric5、konva、leafer 等无参构造引擎
 * - **已有实例**：适用于 playwright 等需要特殊初始化后再构造的引擎
 *
 * @param arg - 引擎构造函数（无参）或已初始化的引擎实例
 * @returns worker 入口函数，接收渲染参数，返回图片 Buffer
 *
 * @example
 * ```ts
 * // 构造函数模式
 * export default await createRenderWorker(FabricEngine);
 *
 * // 已有实例模式（自定义初始化）
 * const browser = await chromium.connect(endpoint);
 * const engine = new PlaywrightEngine(browser);
 * export default await createRenderWorker(engine);
 * ```
 */
export async function createRenderWorker<TEngine extends Engine>(
  arg: (new () => TEngine) | TEngine,
): Promise<RenderFunc<TEngine>> {
  const engine = typeof arg === 'function' ? new (arg as new () => TEngine)() : arg;
  await engine.init();
  return (params) => engine.render(params);
}
