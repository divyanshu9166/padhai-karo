/**
 * Property-based tests for the pure Adaptive_Rebalancer + unused-buffer conversion logic
 * (`./rebalance`).
 *
 *   - Property 18 (task 6.19): rebalancer prefers buffers before compressing (Req 15.2, 15.3).
 *   - Property 19 (task 6.20): unused buffer conversion (Req 15.4, 15.5).
 *
 * Each property is a single fast-check assertion running the global >= 100 iterations
 * (vitest.setup.ts), placed next to {@link planRebalance} / {@link convertUnusedBuffers}.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
    BUFFER_POLICIES,
    convertUnusedBuffers,
    findFillableBuffer,
    planRebalance,
    type BufferPolicy,
    type RebalanceBlock,
} from './rebalance';

const MS_PER_MINUTE = 60 * 1000;
const BASE = new Date('2026-01-05T09:00:00.000Z').getTime();
const SUBJECT_POOL = ['physics', 'chemistry', 'maths'] as const;

describe('rebalance properties', () => {
    // Feature: jee-neet-study-app, Property 18: For any missed study block, if a sufficient buffer slot is available the missed work is rescheduled into a buffer and no other subject's allocation is reduced; only if no buffer fits are other subjects' blocks compressed.
    it('Property 18: rebalancer prefers buffers before compressing (Req 15.2, 15.3)', () => {
        fc.assert(
            fc.property(
                fc.record({
                    subjectId: fc.constantFrom(...SUBJECT_POOL),
                    offsetMin: fc.integer({ min: 0, max: 600 }),
                    durationMin: fc.integer({ min: 30, max: 180 }),
                }),
                fc.array(
                    fc.record({
                        kind: fc.constantFrom('buffer', 'study'),
                        subjectId: fc.constantFrom(...SUBJECT_POOL),
                        offsetMin: fc.integer({ min: 0, max: 1200 }),
                        durationMin: fc.integer({ min: 30, max: 240 }),
                    }),
                    { maxLength: 10 },
                ),
                (missedSpec, otherSpecs) => {
                    const missed: RebalanceBlock = {
                        id: 'missed',
                        subjectId: missedSpec.subjectId,
                        chapterId: 'missed-ch',
                        startTime: new Date(BASE + missedSpec.offsetMin * MS_PER_MINUTE),
                        durationMin: missedSpec.durationMin,
                        isBuffer: false,
                    };
                    const others: RebalanceBlock[] = otherSpecs.map((spec, index) => ({
                        id: `b-${index}`,
                        subjectId: spec.kind === 'buffer' ? null : spec.subjectId,
                        chapterId: spec.kind === 'buffer' ? null : `b-${index}-ch`,
                        startTime: new Date(BASE + spec.offsetMin * MS_PER_MINUTE),
                        durationMin: spec.durationMin,
                        isBuffer: spec.kind === 'buffer',
                    }));
                    const blocks = [missed, ...others];

                    const fillable = findFillableBuffer(missed, blocks);
                    const decision = planRebalance(missed, blocks);

                    if (fillable) {
                        // A fitting buffer is always preferred and no other subject is touched.
                        expect(decision.strategy).toBe('BUFFER_FILL');
                        if (decision.strategy === 'BUFFER_FILL') {
                            expect(decision.bufferId).toBe(fillable.id);
                        }
                    } else {
                        // No buffer fits → either compress other subjects, or nothing is possible.
                        expect(decision.strategy === 'COMPRESS' || decision.strategy === 'NONE').toBe(
                            true,
                        );
                        if (decision.strategy === 'COMPRESS') {
                            // Compression only ever targets OTHER subjects' (non-buffer) blocks.
                            const compressibleIds = new Set(
                                others
                                    .filter(
                                        (b) =>
                                            !b.isBuffer && b.subjectId !== missed.subjectId,
                                    )
                                    .map((b) => b.id),
                            );
                            for (const c of decision.compressions) {
                                expect(compressibleIds.has(c.blockId)).toBe(true);
                                expect(c.reducedByMin).toBeGreaterThan(0);
                            }
                        }
                    }
                },
            ),
        );
    });

    // Feature: jee-neet-study-app, Property 19: For any buffer slot left unused at week end, it is converted to the user's chosen catch-up or extra-revision option.
    it('Property 19: unused buffer conversion (Req 15.4, 15.5)', () => {
        fc.assert(
            fc.property(
                fc.array(
                    fc.record({
                        offsetMin: fc.integer({ min: 0, max: 2000 }),
                        durationMin: fc.integer({ min: 30, max: 120 }),
                    }),
                    { maxLength: 12 },
                ),
                fc.constantFrom<BufferPolicy>(...BUFFER_POLICIES),
                (bufferSpecs, policy) => {
                    const buffers: RebalanceBlock[] = bufferSpecs.map((spec, index) => ({
                        id: `buf-${index}`,
                        subjectId: null,
                        chapterId: null,
                        startTime: new Date(BASE + spec.offsetMin * MS_PER_MINUTE),
                        durationMin: spec.durationMin,
                        isBuffer: true,
                    }));

                    const converted = convertUnusedBuffers(buffers, policy);

                    // One conversion per buffer, in input order, each consuming the reservation
                    // and tagged with the user's chosen option (Req 15.5).
                    expect(converted).toHaveLength(buffers.length);
                    converted.forEach((conversion, index) => {
                        expect(conversion.blockId).toBe(buffers[index].id);
                        expect(conversion.isBuffer).toBe(false);
                        expect(conversion.purpose).toBe(policy);
                    });
                },
            ),
        );
    });
});
