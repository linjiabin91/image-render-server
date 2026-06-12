/**
 * Playwright 浏览器的 FontRegistry 实现
 *
 * 生成 @font-face CSS 注入到 Playwright 页面，遵循统一的注册策略：
 * 1. 按 font-family 分组注册（同一族名下多个字重）
 * 2. 按文件名（去后缀）注册为独立字体别名
 *
 * 服务端引擎用 ttf，Playwright 自动切换为 woff2。
 */
import {existsSync} from "node:fs";
import {type FontDefinition, type FontRegistry, logger} from "@render-server/core";
import {pathToFileURL} from "node:url";
import {type Page} from "playwright-core";

// ── CSS 生成（共享缓存）────────────────────────────────────────────────

let _cachedCSS: string | null = null;
let _cachedKey: string | null = null;

/**
 * 将 FontDefinition 数组生成为 @font-face CSS
 *
 * 自动将 ttf 路径切换为同名的 woff2 文件（如果存在）。
 */
function generateCSS(fonts: FontDefinition[]): string {
  const lines: string[] = [];

  // 按 family 分组
  const groups = new Map<string, FontDefinition[]>();
  for (const font of fonts) {
    const list = groups.get(font.family);
    if (list) list.push(font);
    else groups.set(font.family, [font]);
  }

  for (const [, members] of groups) {
    for (const {family, weight, path} of members) {
      const fontPath = resolveWoff2(path);
      const format = fontPath.endsWith(".woff2") ? "woff2" : "truetype";
      const url = pathToFileURL(fontPath).href;
      lines.push(
        `@font-face{font-family:'${family}';src:url('${url}')format('${format}');font-weight:${weight}}`,
      );
    }
  }

  // 兼容旧模板：别名注册
  for (const {path} of fonts) {
    const fontPath = resolveWoff2(path);
    const format = fontPath.endsWith(".woff2") ? "woff2" : "truetype";
    const alias = fontPath.split("/").pop()!.replace(/\.(ttf|otf|woff2)$/i, "");
    const url = pathToFileURL(fontPath).href;
    lines.push(
      `@font-face{font-family:'${alias}';src:url('${url}')format('${format}')}`,
    );
  }

  return lines.join("\n");
}

/** 尝试将 ttf/otf 路径切换为同名的 woff2 */
function resolveWoff2(path: string): string {
  const woff2 = path.replace(/\.(ttf|otf)$/i, ".woff2");
  return path !== woff2 && existsSync(woff2) ? woff2 : path;
}

/**
 * 生成缓存键
 */
function cacheKey(fonts: FontDefinition[]): string {
  return fonts.map((f) => `${f.family}:${f.weight}:${f.path}`).join("|");
}

// ── 注册器 ─────────────────────────────────────────────────────────────

export class PlaywrightFontRegistry implements FontRegistry {
  constructor(private readonly page: Page) {}

  async register(fonts: FontDefinition[]): Promise<void> {
    // 缓存 CSS，避免重复计算
    const key = cacheKey(fonts);
    if (_cachedKey !== key) {
      _cachedCSS = generateCSS(fonts);
      _cachedKey = key;
    }
    if (!_cachedCSS) return;

    try {
      // 注入 @font-face CSS
      await this.page.evaluate((css) => {
        const style = document.createElement("style");
        style.textContent = css;
        document.head.appendChild(style);
      }, _cachedCSS);

      // 显式加载每个字体族，确保浏览器下载完毕
      const families: string[] = [];
      for (const font of fonts) {
        if (!families.includes(font.family)) families.push(font.family);
        const alias = font.path.split("/").pop()!.replace(/\.(ttf|otf)$/i, "");
        if (!families.includes(alias)) families.push(alias);
      }
      await this.page.evaluate((fams: string[]) => {
        return Promise.all(fams.map((f) => document.fonts.load(`1px "${f}"`)));
      }, families);
    } catch (err) {
      logger.warn({err}, "font injection failed");
    }
  }
}
