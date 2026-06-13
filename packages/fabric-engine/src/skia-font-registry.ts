/**
 * skia-canvas 字体的 FontRegistry 实现
 *
 * 将 FontDefinition 数组注册到 skia-canvas 的 FontLibrary。支持：
 * - 按 font-family 分组注册（同一族名下多个字重）
 * - 兼容旧模板：每个文件按完整文件名注册为独立字体的别名
 */
import {type FontDefinition, type FontRegistry, logger} from "@image-render-server/core";
import {FontLibrary} from 'skia-canvas';

export class SkiaFontRegistry implements FontRegistry {
  register(fonts: FontDefinition[]): void {
    // 按 font-family 分组
    const groups = new Map<string, FontDefinition[]>();
    for (const font of fonts) {
      const list = groups.get(font.family);
      if (list) {
        list.push(font);
      } else {
        groups.set(font.family, [font]);
      }
    }

    // 分组注册到 FontLibrary
    for (const [family, members] of groups) {
      const paths = members.map((f) => f.path);
      try {
        FontLibrary.use(family, paths.length === 1 ? paths[0] : paths);
      } catch (err) {
        logger.warn({err, font: family}, "font group registration failed");
      }
      // 同时按完整文件名注册别名，兼容旧模板
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