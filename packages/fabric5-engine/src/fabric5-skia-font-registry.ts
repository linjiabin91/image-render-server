/**
 * skia-canvas 字体的 FontRegistry 实现（Fabric.js 5 专用）
 *
 * 与 fabric-engine 的 SkiaFontRegistry 互不兼容。
 * 将 FontDefinition 数组注册到 skia-canvas 的 FontLibrary，支持：
 * - 按 font-family 分组注册
 * - 按完整文件名注册为独立别名
 */
import {type FontDefinition, type FontRegistry, logger} from "@image-render-server/core";
import {FontLibrary} from 'skia-canvas';

export class Fabric5SkiaFontRegistry implements FontRegistry {
  register(fonts: FontDefinition[]): void {
    const groups = new Map<string, FontDefinition[]>();
    for (const font of fonts) {
      const list = groups.get(font.family);
      if (list) {
        list.push(font);
      } else {
        groups.set(font.family, [font]);
      }
    }

    for (const [family, members] of groups) {
      const paths = members.map((f) => f.path);
      try {
        FontLibrary.use(family, paths.length === 1 ? paths[0] : paths);
      } catch (err) {
        logger.warn({err, font: family}, "font group registration failed");
      }
      for (const {path} of members) {
        const name = path.split('/').pop()!.replace(/\.(ttf|otf)$/i, '');
        try {
          FontLibrary.use(name, path);
        } catch (err) {
          logger.warn({err, font: name}, "font alias registration failed");
        }
      }
    }
  }
}