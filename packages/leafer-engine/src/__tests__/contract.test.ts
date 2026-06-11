import { describe, expect, it } from 'vitest';
import { LeaferEngine } from '../leafer.engine.js';

describe('LeaferEngine contract', () => {
    it('exports LeaferEngine class', () => {
        expect(LeaferEngine).toBeDefined();
        expect(typeof LeaferEngine).toBe('function');
    });

    it('has init/render/destroy methods', () => {
        const engine = new LeaferEngine();
        expect(typeof engine.init).toBe('function');
        expect(typeof engine.render).toBe('function');
        expect(typeof engine.destroy).toBe('function');
    });

    it('render throws before init', async () => {
        const engine = new LeaferEngine();
        await expect(engine.render({
            options: {} as any,
            templateJson: { width: 100, height: 100, children: [] },
            variables: {},
        })).rejects.toThrow('not initialized');
    });
});
