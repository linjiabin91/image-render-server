/**
 * Fabric7 引擎集成测试 — 需要 native 模块，仅在本地运行。
 *
 * 通过 pnpm test:integration 执行。
 */
import { describe, expect, it } from 'vitest';
import { FabricEngine, type FabricTemplateJson } from '../fabric.engine.js';

describe('FabricEngine (v7) render', () => {
    it('renders text-only template to PNG buffer', async () => {
        const engine = new FabricEngine();
        try {
            await engine.init();

            const template: FabricTemplateJson = {
                version: '7.0.0',
                objects: [
                    { type: 'i-text', text: 'Hello Fabric7', left: 10, top: 10, fontSize: 20, fill: '#333' },
                ],
            };

            const result = await engine.render({
                options: { width: 200, height: 100, format: 'png', quantity: 80, compressLevel: 0, pixelRatio: 1 },
                templateJson: template,
                variables: {},
            });

            expect(result).toBeInstanceOf(Buffer);
            expect(result.length).toBeGreaterThan(100);
            expect(result[0]).toBe(0x89);
            expect(result[1]).toBe(0x50);
        } finally {
            engine.destroy();
        }
    });
});
