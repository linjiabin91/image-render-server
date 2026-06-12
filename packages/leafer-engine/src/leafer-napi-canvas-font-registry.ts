/**
 * @napi-rs/canvas 字体的 FontRegistry 实现（Leafer 引擎专用）
 *
 * 逐个文件注册到 @napi-rs/canvas 的 GlobalFonts。
 * 与 konva-engine 的 NapiCanvasFontRegistry 相互独立。
 */
import {type FontDefinition, type FontRegistry, logger} from "@render-server/core";
import napi from '@napi-rs/canvas';

export class LeaferNapiCanvasFontRegistry implements FontRegistry {
  register(fonts: FontDefinition[]): void {
    for (const {path} of fonts) {
      const name = path.split('/').pop()!.replace(/\.(ttf|otf)$/i, '');
      try {
        napi.GlobalFonts.registerFromPath(path, name);
      } catch (err) {
        logger.warn({err, font: name}, "font registration failed");
      }
    }
  }
}