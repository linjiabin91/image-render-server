import { describe, expect, it } from 'vitest';

describe('PlaywrightEngine contract', () => {
    it('exports PlaywrightEngine class', async () => {
        const mod = await import('../playwright.engine.js');
        expect(mod.PlaywrightEngine).toBeDefined();
        expect(typeof mod.PlaywrightEngine).toBe('function');
    });

    it('has init/render/destroy on prototype', async () => {
        const mod = await import('../playwright.engine.js');
        const proto = mod.PlaywrightEngine.prototype;
        expect(typeof proto.init).toBe('function');
        expect(typeof proto.render).toBe('function');
        expect(typeof proto.destroy).toBe('function');
    });
});
