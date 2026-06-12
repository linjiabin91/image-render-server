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
 *
 * 统一注册策略：
 * 1. 按 font-family 分组注册（同一族名下多个字重）
 * 2. 按文件名（去后缀）注册为独立字体别名，兼容旧模板
 */
export interface FontRegistry {
  /**
   * 注册一组字体到渲染后端
   *
   * @param fonts - 字体定义列表
   */
  register(fonts: FontDefinition[]): void | Promise<void>;
}

/**
 * 默认字重映射（阿里巴巴普惠体 3）
 *
 * Light(45) → CSS 300，Normal(55) → CSS 400，Bold(85) → CSS 700
 */
export const DEFAULT_WEIGHT_MAP: Record<number, number> = {
  45: 300,
  55: 400,
  85: 700,
};

/**
 * 扫描字体目录的选项
 */
export interface ScanFontsOptions {
  /**
   * 字重映射：将文件名中提取的 vendor 字重映射为 CSS font-weight。
   * 未在映射中的字重会被跳过（不注册）。
   * 默认使用 {@link DEFAULT_WEIGHT_MAP}。
   */
  weightMap?: Record<number, number>;
}

/**
 * 扫描字体目录，从文件名推断族名和字重
 *
 * 文件名约定：`{familyPrefix}-{weightIndex}-{weightName}.ttf`
 * 例：`AlibabaPuHuiTi-3-45-Light.ttf` → family=`AlibabaPuHuiTi-3`, weight=`45`
 * 仅识别 `.ttf` 和 `.otf` 文件。
 *
 * @param fontsDir - 字体文件所在目录的绝对路径
 * @param options - 扫描选项（可选）
 * @returns FontDefinition 数组
 */
export function scanFontsDir(fontsDir: string, options?: ScanFontsOptions): FontDefinition[] {
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
    if (!Number.isFinite(weight)) continue;
    // 应用字重映射：未在映射中的跳过
    const weightMap = options?.weightMap ?? DEFAULT_WEIGHT_MAP;
    const cssWeight = weightMap[weight];
    if (cssWeight === undefined) continue;
    fonts.push({
      family,
      weight: cssWeight ?? weight,
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
 * @param options - 扫描选项（可选，透传 scanFontsDir）
 */
export function autoRegisterFonts(
  registry: FontRegistry,
  importMetaUrl: string,
  fontsDir?: string,
  options?: ScanFontsOptions,
): void {
  const dir = resolveFontsDir(importMetaUrl, fontsDir);
  const fonts = scanFontsDir(dir, options);
  if (fonts.length > 0) {
    registry.register(fonts);
  }
}
