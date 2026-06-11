import { describe, expect, it } from 'vitest';
import { KonvaEngine } from '../konva.engine.js';

describe('KonvaEngine contract', () => {
    it('exports KonvaEngine class', () => {
        expect(KonvaEngine).toBeDefined();
        expect(typeof KonvaEngine).toBe('function');
    });

    it('has init/render/destroy methods', () => {
        const engine = new KonvaEngine();
        expect(typeof engine.init).toBe('function');
        expect(typeof engine.render).toBe('function');
        expect(typeof engine.destroy).toBe('function');
    });

    it('render throws before init', async () => {
        const engine = new KonvaEngine();
        await expect(engine.render({
            options: {} as any, // eslint-disable-line @typescript-eslint/no-explicit-any -- 测试预初始化守卫
            templateJson: { width: 100, height: 100, children: [] },
            variables: {},
        })).rejects.toThrow('not initialized');
    });
});
