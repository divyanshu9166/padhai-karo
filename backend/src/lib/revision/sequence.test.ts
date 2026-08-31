import { describe, expect, it } from 'vitest';

import { addUtcDays, REVISION_SEQUENCE } from './sequence';

describe('visible revision sequence', () => {
    it('keeps the requested first-study and spaced checkpoints', () => {
        expect(REVISION_SEQUENCE.map((item) => [item.phase, item.label, item.offsetDays])).toEqual([
            ['FIRST_STUDY', 'First Study', 0],
            ['REVISION_1', 'Revision 1', 1],
            ['REVISION_2', 'Revision 2', 3],
            ['FINAL_REVISION', 'Final Revision', 7],
            ['LONG_TERM', 'Long-term Revision', 21],
        ]);
    });

    it('does not mutate the chapter completion date', () => {
        const base = new Date('2026-08-19T00:00:00.000Z');
        expect(addUtcDays(base, 21).toISOString()).toBe('2026-09-09T00:00:00.000Z');
        expect(base.toISOString()).toBe('2026-08-19T00:00:00.000Z');
    });
});
