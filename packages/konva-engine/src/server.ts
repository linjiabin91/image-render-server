/**
 * Konva 引擎服务端启动入口
 *
 * 使用通用的 createEngineServer 挂载 Piscina worker，启动 HTTP 服务。
 */
import {createEngineServer} from "@render-server/server";
export const startServer = createEngineServer("KonvaEngine", import.meta.url);
