/**
 * 图片编码工具函数
 *
 * 封装 @napi-rs/image 的 Transformer PNG 编码，各引擎统一调用。
 */
import {CompressionType, Transformer} from '@napi-rs/image';

/**
 * 将 RGBA 像素数据编码为 PNG Buffer
 *
 * @param pixels - RGBA 像素数据 Buffer
 * @param width - 图片宽度（像素）
 * @param height - 图片高度（像素）
 * @param compressLevel - 压缩级别（0-10，0=默认，1-5=高质量，6-10=快速）
 * @returns PNG 编码后的 Buffer
 */
export function encodePngRgba(pixels: Buffer | Uint8ClampedArray | Uint8Array, width: number, height: number, compressLevel = 0): Buffer {
    const tx = Transformer.fromRgbaPixels(pixels, width, height);
    return tx.pngSync({
        compressionType: compressLevel === 0
            ? CompressionType.Default
            : compressLevel <= 5
                ? CompressionType.Best
                : CompressionType.Fast,
    });
}
