/**
 * 变量替换 — 将 json 中所有 {{key}} 替换为 variable 中的值
 *
 * @param j - 模板 JSON
 * @param v - 变量键值映射
 * @returns 替换后的 JSON
 */
export function resolveVariables<T>(j: T, v: Record<string, string>): T {
    return JSON.parse(JSON.stringify(j).replace(/\{\{(\w+)}}/g, (_, k: string) => v[k] ?? `{{${k}}}`));
}
