import { describe, expect, it } from 'vitest';
import { toQuantity } from './types.js';

describe('toQuantity', () => {
    it('returns valid Quantity for 0-100', () => {
        expect(toQuantity(0)).toBe(0);
        expect(toQuantity(50)).toBe(50);
        expect(toQuantity(100)).toBe(100);
    });

    it('throws for negative numbers', () => {
        expect(() => toQuantity(-1)).toThrow();
    });

    it('throws for numbers > 100', () => {
        expect(() => toQuantity(101)).toThrow();
    });
});
