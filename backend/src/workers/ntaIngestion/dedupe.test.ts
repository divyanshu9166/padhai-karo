import { describe, expect, it } from 'vitest';

import { computeDedupeHash, type DedupeInput } from './dedupe';

const base: DedupeInput = {
    examScope: 'JEE_MAIN',
    title: 'JEE Main 2026 exam date announced',
    body: 'The exam will be held in April 2026.',
    publishedAt: new Date('2025-01-15T09:00:00.000Z'),
};

describe('computeDedupeHash', () => {
    it('produces a 64-char hex sha-256 digest', () => {
        expect(computeDedupeHash(base)).toMatch(/^[0-9a-f]{64}$/);
    });

    it('is stable across calls for identical input', () => {
        expect(computeDedupeHash(base)).toBe(computeDedupeHash({ ...base }));
    });

    it('treats equal instants from different Date objects as identical', () => {
        const other: DedupeInput = { ...base, publishedAt: new Date(base.publishedAt.getTime()) };
        expect(computeDedupeHash(other)).toBe(computeDedupeHash(base));
    });

    it('differs when examScope differs', () => {
        expect(computeDedupeHash({ ...base, examScope: 'NEET' })).not.toBe(computeDedupeHash(base));
    });

    it('differs when title differs', () => {
        expect(computeDedupeHash({ ...base, title: 'Different title' })).not.toBe(
            computeDedupeHash(base),
        );
    });

    it('differs when body differs', () => {
        expect(computeDedupeHash({ ...base, body: 'Different body' })).not.toBe(
            computeDedupeHash(base),
        );
    });

    it('differs when publishedAt differs', () => {
        expect(
            computeDedupeHash({ ...base, publishedAt: new Date('2025-02-01T00:00:00.000Z') }),
        ).not.toBe(computeDedupeHash(base));
    });

    it('does not confuse a title/body boundary shift (no delimiter injection)', () => {
        const a = computeDedupeHash({ ...base, title: 'ab', body: 'cd' });
        const b = computeDedupeHash({ ...base, title: 'a', body: 'bcd' });
        expect(a).not.toBe(b);
    });
});
