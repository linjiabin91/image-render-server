import {existsSync, readdirSync, statSync} from "node:fs";
import {dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";

/**
 * 字体定义 — 描述一个字体的族名、字重和文件路径
 */
export interface FontDefinition {
  /** 字体族名 */
  family: string;
  /** 字重（CSS font-weight 数值，如 400、700） */
  weight: number;
  /** 字体文件绝对路径 */
  path: string;
  /** 字体格式（如 truetype、woff2、opentype），默认 truetype */
  format?: string;
}

/**
 * 字体注册器接口
 *
 * 各渲染引擎根据自身后端 API 自行实现此接口，
 * 将字体注册到对应绘制后端（skia-canvas / @napi-rs/canvas 等）。
 */
export interface FontRegistry {
  /**
   * 注册一组字体到渲染后端
   *
   * @param fonts - 字体定义列表
   */
  register(fonts: FontDefinition[]): void;
}

/**
 * 扫描字体目录，从文件名推断族名和字重
 *
 * 文件名约定：`{familyPrefix}-{weightIndex}-{weightName}.ttf`
 * 例：`AlibabaPuHuiTi-3-45-Light.ttf` → family=`AlibabaPuHuiTi-3`, weight=`45`
 * 仅识别 `.ttf` 和 `.otf` 文件，woff2 仅在浏览器场景使用。
 *
 * @param fontsDir - 字体文件所在目录的绝对路径
 * @returns FontDefinition 数组
 */
export function scanFontsDir(fontsDir: string): FontDefinition[] {
  if (!existsSync(fontsDir)) return [];

  const fonts: FontDefinition[] = [];
  for (const file of readdirSync(fontsDir)) {
    const lower = file.toLowerCase();
    if (!lower.endsWith('.ttf') && !lower.endsWith('.otf')) continue;
    const fullPath = resolve(fontsDir, file);
    if (!statSync(fullPath).isFile()) continue;
    const name = file.slice(0, lower.endsWith('.ttf') ? -4 : -4);
    const parts = name.split('-');
    const family = parts.length >= 3 ? parts.slice(0, -2).join('-') : name;
    const weight = parseInt(parts[parts.length - 2], 10);
    fonts.push({
      family,
      weight: Number.isFinite(weight) ? weight : 400,
      path: fullPath,
    });
  }
  return fonts;
}

/**
 * 解析字体目录路径
 *
 * 优先级（从高到低）：
 * 1. `FONTS_DIR` 环境变量（绝对路径）
 * 2. `fontsDir` 参数（引擎自定义覆盖）
 * 3. 相对于调用模块的默认路径 `../../core/fonts`
 *
 * @param importMetaUrl - 调用模块的 `import.meta.url`
 * @param fontsDir - 引擎自定义字体目录（可选）
 * @returns 字体目录绝对路径
 */
export function resolveFontsDir(
  importMetaUrl: string,
  fontsDir?: string,
): string {
  return process.env.FONTS_DIR
    ?? fontsDir
    ?? resolve(dirname(fileURLToPath(importMetaUrl)), '../../core/fonts');
}

/**
 * 自动扫描并注册字体
 *
 * 一键完成"解析目录 → 扫描文件 → 注册到后端"全流程。
 * 各引擎模块顶层调用，替代手写 `__dirname`/`resolve`/`scanFontsDir`/`register` 模板代码。
 *
 * 字体目录优先级：`FONTS_DIR` 环境变量 > `fontsDir` 参数 > 默认相对路径
 *
 * @param registry - FontRegistry 实现实例
 * @param importMetaUrl - 调用模块的 `import.meta.url`
 * @param fontsDir - 引擎自定义字体目录（可选，覆盖默认相对路径）
 */
export function autoRegisterFonts(
  registry: FontRegistry,
  importMetaUrl: string,
  fontsDir?: string,
): void {
  const dir = resolveFontsDir(importMetaUrl, fontsDir);
  const fonts = scanFontsDir(dir);
  if (fonts.length > 0) {
    registry.register(fonts);
  }
}
