/**
 * @napi-rs/canvas 字体的 FontRegistry 实现
 *
 * 逐个文件注册到 GlobalFonts。每个字体文件注册为一个独立字体（不含字重分组）。
 * @napi-rs/canvas 的 GlobalFonts 不支持按族名+字重分组注册。
 */
import {type FontDefinition, type FontRegistry, logger} from "@image-render-server/core";
import {GlobalFonts} from '@napi-rs/canvas';

export class NapiCanvasFontRegistry implements FontRegistry {
  register(fonts: FontDefinition[]): void {
    for (const {path, family, weight} of fonts) {
      const name = path.split('/').pop()!.replace(/\.(ttf|otf)$/i, '');
      try {
        GlobalFonts.registerFromPath(path, name);
      } catch (err) {
        logger.warn({err, font: name, family, weight}, "font registration failed");
      }
    }
  }
}