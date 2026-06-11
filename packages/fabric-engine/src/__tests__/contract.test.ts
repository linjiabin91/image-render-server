import { describe, expect, it } from 'vitest';
import { FabricEngine } from '../fabric.engine.js';

describe('FabricEngine (v7) contract', () => {
    it('exports FabricEngine class', () => {
        expect(FabricEngine).toBeDefined();
        expect(typeof FabricEngine).toBe('function');
    });

    it('has init/render/destroy methods', () => {
        const engine = new FabricEngine();
        expect(typeof engine.init).toBe('function');
        expect(typeof engine.render).toBe('function');
        expect(typeof engine.destroy).toBe('function');
    });

    it('render throws before init', async () => {
        const engine = new FabricEngine();
        await expect(engine.render({
            options: {} as any, // eslint-disable-line @typescript-eslint/no-explicit-any -- 测试预初始化守卫
            templateJson: { version: '7.0.0', objects: [] },
            variables: {},
        })).rejects.toThrow(/not initialized/i);
    });
});
