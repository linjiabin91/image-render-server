/** 图片输出格式 */
export type ImageFormat = "png" | "jpeg";

/**
 * 0-100 的整数
 * - 使用时通过 `as Quantity` 转换
 * - 或使用 `toQuantity(n)` 进行运行时校验
 */
export type Quantity = number & { readonly __brand: "Quantity" };

/**
 * 将数字转换为 Quantity，超出范围时抛错
 */
export function toQuantity(n: number): Quantity {
  if (!Number.isInteger(n) || n < 0 || n > 100) {
    throw new Error(`Quantity must be an integer between 0 and 100, got ${n}`);
  }
  return n as Quantity;
}

/** 0-10 的整数 */
export type CompressLevel = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

/** 渲染参数配置 */
export interface RenderOptions {
  /** 输出图片宽度（像素） */
  width: number;
  /** 输出图片高度（像素） */
  height: number;
  /** 输出图片格式 */
  format: ImageFormat;
  /** 输出图片数量（0-100 的整数） */
  quantity: Quantity;
  /** 压缩级别（0-10 的整数） */
  compressLevel: CompressLevel;
  /** 像素倍率（默认 1），2 表示 2x 高清输出 */
  pixelRatio?: number;
}
