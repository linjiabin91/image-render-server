import { describe, expect, it } from 'vitest';
import { resolveVariables } from './resolve-variables.js';

describe('resolveVariables', () => {
    it('replaces {{key}} with variable value', () => {
        const result = resolveVariables({ text: 'Hello {{name}}' }, { name: 'World' });
        expect(result).toEqual({ text: 'Hello World' });
    });

    it('leaves unreplaced variables as-is', () => {
        const result = resolveVariables({ text: '{{missing}}' }, {});
        expect(result).toEqual({ text: '{{missing}}' });
    });

    it('handles multiple variables', () => {
        const result = resolveVariables(
            { a: '{{x}}', b: '{{y}}' },
            { x: '1', y: '2' },
        );
        expect(result).toEqual({ a: '1', b: '2' });
    });

    it('handles nested JSON structures', () => {
        const json = { children: [{ tag: 'Text', text: '{{msg}}' }] };
        const result = resolveVariables(json, { msg: 'hello' });
        expect(result).toEqual({ children: [{ tag: 'Text', text: 'hello' }] });
    });

    it('handles empty variables', () => {
        const result = resolveVariables({ text: 'plain' }, {});
        expect(result).toEqual({ text: 'plain' });
    });
});
