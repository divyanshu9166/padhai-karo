import { describe, expect, it } from 'vitest';

/**
 * DB-independent unit tests for the pure Adaptive_Rebalancer + buffer-policy + unused-buffer
 * conversion logic (task 6.8; design "Adaptive Rebalancer"; Req 15.2, 15.3, 15.4, 15.5).
 *
 * These cover the decisions the task calls out without touching a database:
 *   - the rebalancer prefers an available buffer (fills it, reduces no other subject) over
 *     compression (Req 15.2);
 *   - it compresses other subjects' blocks only when no buffer fits (Req 15.3);
 *   - buffer-policy validation accepts only the two valid values (Req 15.4);
 *   - unused buffers convert to the user's chosen option (Req 15.4/15.5).
 *
 * The HTTP handlers and example-only property tests (Properties 18/19) are out of scope here.
 */
import {
    MIN_COMPRESSED_BLOCK_MIN,
    compressOtherSubjects,
    convertUnusedBuffers,
    findFillableBuffer,
    isBufferPolicy,
    parseBufferPolicy,
    planRebalance,
    type RebalanceBlock,
} from './rebalance';

/** Build a study/buffer block from a UTC ISO start and a duration in minutes. */
function block(
    id: string,
    startIso: string,
    durationMin: number,
    options: { subjectId?: string | null; isBuffer?: boolean } = {},
): RebalanceBlock {
    return {
        id,
        subjectId: options.subjectId ?? (options.isBuffer ? null : 'subj-default'),
        chapterId: options.isBuffer ? null : `${id}-chapter`,
        startTime: new Date(startIso),
        durationMin,
        isBuffer: options.isBuffer ?? false,
    };
}

// 2026-01-05 is a Monday (UTC).
const DAY = '2026-01-05';

describe('findFillableBuffer', () => {
    const missed = block('missed', `${DAY}T09:00:00.000Z`, 60, { subjectId: 'physics' });

    it('returns the earliest later buffer of sufficient size', () => {
        const blocks = [
            missed,
            block('buf-late', `${DAY}T15:00:00.000Z`, 60, { isBuffer: true }),
            block('buf-early', `${DAY}T11:00:00.000Z`, 90, { isBuffer: true }),
        ];
        expect(findFillableBuffer(missed, blocks)?.id).toBe('buf-early');
    });

    it('ignores buffers that are too small', () => {
        const blocks = [missed, block('buf-small', `${DAY}T11:00:00.000Z`, 30, { isBuffer: true })];
        expect(findFillableBuffer(missed, blocks)).toBeNull();
    });

    it('ignores buffers that start before the missed block', () => {
        const blocks = [missed, block('buf-past', `${DAY}T07:00:00.000Z`, 90, { isBuffer: true })];
        expect(findFillableBuffer(missed, blocks)).toBeNull();
    });

    it('ignores non-buffer blocks', () => {
        const blocks = [missed, block('study', `${DAY}T11:00:00.000Z`, 90, { isBuffer: false })];
        expect(findFillableBuffer(missed, blocks)).toBeNull();
    });
});

describe('planRebalance', () => {
    const missed = block('missed', `${DAY}T09:00:00.000Z`, 60, { subjectId: 'physics' });

    it('prefers filling an available buffer and reduces no other subject (Req 15.2)', () => {
        const blocks = [
            missed,
            block('chem', `${DAY}T11:00:00.000Z`, 120, { subjectId: 'chemistry' }),
            block('buf', `${DAY}T13:00:00.000Z`, 60, { isBuffer: true }),
        ];
        const decision = planRebalance(missed, blocks);
        expect(decision).toEqual({ strategy: 'BUFFER_FILL', bufferId: 'buf' });
    });

    it('compresses other subjects only when no buffer fits (Req 15.3)', () => {
        const blocks = [
            missed,
            block('chem', `${DAY}T11:00:00.000Z`, 120, { subjectId: 'chemistry' }),
            block('maths', `${DAY}T14:00:00.000Z`, 120, { subjectId: 'maths' }),
        ];
        const decision = planRebalance(missed, blocks);
        expect(decision.strategy).toBe('COMPRESS');
        if (decision.strategy === 'COMPRESS') {
            const totalFreed = decision.compressions.reduce((sum, c) => sum + c.reducedByMin, 0);
            expect(totalFreed).toBe(missed.durationMin);
            // No compressed block drops below the minimum.
            for (const c of decision.compressions) {
                expect(c.newDurationMin).toBeGreaterThanOrEqual(MIN_COMPRESSED_BLOCK_MIN);
            }
        }
    });

    it('never compresses the missed block\'s own subject', () => {
        const blocks = [
            missed,
            block('phys2', `${DAY}T11:00:00.000Z`, 120, { subjectId: 'physics' }),
        ];
        const decision = planRebalance(missed, blocks);
        // Only same-subject block exists -> nothing compressible.
        expect(decision.strategy).toBe('NONE');
    });

    it('returns NONE when neither a buffer nor compressible block exists', () => {
        const blocks = [missed];
        expect(planRebalance(missed, blocks)).toEqual({ strategy: 'NONE' });
    });
});

describe('compressOtherSubjects', () => {
    it('frees exactly the needed minutes proportional to reducible capacity', () => {
        const blocks = [
            block('a', `${DAY}T11:00:00.000Z`, 90, { subjectId: 'chemistry' }),
            block('b', `${DAY}T13:00:00.000Z`, 150, { subjectId: 'maths' }),
        ];
        const compressions = compressOtherSubjects(60, blocks);
        const totalFreed = compressions.reduce((sum, c) => sum + c.reducedByMin, 0);
        expect(totalFreed).toBe(60);
    });

    it('best-effort frees all capacity when demand exceeds what is reducible', () => {
        const blocks = [block('a', `${DAY}T11:00:00.000Z`, 60, { subjectId: 'chemistry' })];
        // Reducible capacity = 60 - 30 = 30, but 120 requested.
        const compressions = compressOtherSubjects(120, blocks);
        const totalFreed = compressions.reduce((sum, c) => sum + c.reducedByMin, 0);
        expect(totalFreed).toBe(30);
        expect(compressions[0].newDurationMin).toBe(MIN_COMPRESSED_BLOCK_MIN);
    });

    it('returns no compressions when no block can shrink', () => {
        const blocks = [block('a', `${DAY}T11:00:00.000Z`, MIN_COMPRESSED_BLOCK_MIN)];
        expect(compressOtherSubjects(60, blocks)).toEqual([]);
    });

    it('returns no compressions for a non-positive demand', () => {
        const blocks = [block('a', `${DAY}T11:00:00.000Z`, 120)];
        expect(compressOtherSubjects(0, blocks)).toEqual([]);
    });
});

describe('buffer-policy validation (Req 15.4)', () => {
    it('accepts the two valid policy values', () => {
        expect(parseBufferPolicy('CATCH_UP')).toBe('CATCH_UP');
        expect(parseBufferPolicy('EXTRA_REVISION')).toBe('EXTRA_REVISION');
        expect(isBufferPolicy('CATCH_UP')).toBe(true);
    });

    it('rejects invalid values', () => {
        expect(parseBufferPolicy('catch_up')).toBeNull();
        expect(parseBufferPolicy('REVISION')).toBeNull();
        expect(parseBufferPolicy(42)).toBeNull();
        expect(parseBufferPolicy(undefined)).toBeNull();
        expect(isBufferPolicy('nope')).toBe(false);
    });
});

describe('convertUnusedBuffers (Req 15.5)', () => {
    const buffers = [
        block('buf1', `${DAY}T13:00:00.000Z`, 60, { isBuffer: true }),
        block('buf2', `${DAY}T17:00:00.000Z`, 30, { isBuffer: true }),
    ];

    it('converts every unused buffer to the chosen CATCH_UP option', () => {
        const converted = convertUnusedBuffers(buffers, 'CATCH_UP');
        expect(converted).toEqual([
            { blockId: 'buf1', isBuffer: false, purpose: 'CATCH_UP' },
            { blockId: 'buf2', isBuffer: false, purpose: 'CATCH_UP' },
        ]);
    });

    it('converts every unused buffer to the chosen EXTRA_REVISION option', () => {
        const converted = convertUnusedBuffers(buffers, 'EXTRA_REVISION');
        expect(converted.every((c) => c.purpose === 'EXTRA_REVISION')).toBe(true);
        expect(converted.every((c) => c.isBuffer === false)).toBe(true);
    });

    it('returns an empty list when there are no unused buffers', () => {
        expect(convertUnusedBuffers([], 'CATCH_UP')).toEqual([]);
    });
});
