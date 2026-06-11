/**
 * Konva 引擎集成测试 — 需要 native 模块，仅在本地运行。
 *
 * 通过 pnpm test:integration 执行。
 */
import { describe, expect, it } from 'vitest';
import { toQuantity } from '@render-server/core';
import { KonvaEngine, type KonvaTemplateJson } from '../konva.engine.js';

describe('KonvaEngine render', () => {
    it('renders text-only template to PNG buffer', async () => {
        const engine = new KonvaEngine();
        try {
            await engine.init();

            const template: KonvaTemplateJson = {
                width: 200,
                height: 100,
                children: [
                    { tag: 'Text', x: 10, y: 10, text: 'Hello Konva', fontSize: 20, fill: '#333' },
                ],
            };

            const result = await engine.render({
                options: { width: 200, height: 100, format: 'png', quantity: toQuantity(80), compressLevel: 0, pixelRatio: 1 },
                templateJson: template,
                variables: {},
            });

            expect(result).toBeInstanceOf(Buffer);
            expect(result.length).toBeGreaterThan(100);
            // PNG magic bytes
            expect(result[0]).toBe(0x89);
            expect(result[1]).toBe(0x50);
            expect(result[2]).toBe(0x4E);
            expect(result[3]).toBe(0x47);
        } finally {
            try { engine.destroy(); } catch { /* cleanup ok */ }
        }
    });
});
