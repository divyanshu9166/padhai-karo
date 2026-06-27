/**
 * Property-based test for Combined_Weightage_Signal min-max normalization
 * (task 4.3; design "Correctness Properties → Property 4").
 *
 *   - Property 4: Combined_Weightage_Signal normalizes onto [0,1]
 *     Validates: Requirements 3.2, 3.5
 *
 * Property 4 (design statement): For any non-empty set of Chapters, every
 * normalized `Combined_Weightage_Signal` lies in the inclusive range 0 to 1,
 * the Chapter with the highest pre-normalization signal is assigned 1 and the
 * Chapter with the lowest is assigned 0, and when every Chapter's
 * pre-normalization signal is equal (including the all-zero case) every Chapter
 * is assigned 0.
 *
 * `combinedWeightageSignal` is pure and database-free, so this test needs no
 * mocks. It exercises the real min-max normalization across generated Chapter
 * sets. To avoid a file collision with task 4.2 (which tests Property 3 against
 * the same module), this property lives in its own `*.normalization.property.test.ts`.
 *
 * fast-check assertions run a minimum of 100 iterations each.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { combinedWeightageSignal, type ChapterSignalInput } from './signal';

/**
 * A frequency value generator constrained to the real input space: non-negative,
 * finite numbers (PYQ and historical frequencies are counts / averages `>= 0`).
 */
const frequencyArb = fc.double({ min: 0, max: 1_000, noNaN: true, noDefaultInfinity: true });

/** A single Chapter's signal inputs with a unique referenceKey supplied by the caller. */
function chapterInputArb(referenceKey: string): fc.Arbitrary<ChapterSignalInput> {
    return fc.record({
        chapterId: fc.constant(`ch-${referenceKey}`),
        referenceKey: fc.constant(referenceKey),
        pyqFrequency: frequencyArb,
        historicalFrequency: frequencyArb,
        hasHistoricalData: fc.boolean(),
    });
}

/** A non-empty set of Chapters with distinct, deterministic referenceKeys. */
const chapterSetArb: fc.Arbitrary<ChapterSignalInput[]> = fc
    .integer({ min: 1, max: 12 })
    .chain((count) =>
        fc.tuple(
            ...Array.from({ length: count }, (_unused, index) =>
                chapterInputArb(`k${String(index).padStart(2, '0')}`),
            ),
        ),
    )
    .map((entries) => [...entries]);

describe('combinedWeightageSignal normalization (Property 4)', () => {
    // Feature: weightage-based-time-allocation, Property 4: Combined_Weightage_Signal
    // normalizes onto [0,1]
    it('Property 4: normalizes signals into [0,1] with max->1 and min->0 (Req 3.2, 3.5)', () => {
        fc.assert(
            fc.property(chapterSetArb, (inputs) => {
                const results = combinedWeightageSignal(inputs);

                // Output preserves the input set one-to-one.
                expect(results).toHaveLength(inputs.length);

                // Every normalized signal lies in the inclusive range [0, 1] (Req 3.2).
                for (const result of results) {
                    expect(result.combinedWeightageSignal).toBeGreaterThanOrEqual(0);
                    expect(result.combinedWeightageSignal).toBeLessThanOrEqual(1);
                }

                const rawSignals = results.map((r) => r.rawSignal);
                const maxRaw = Math.max(...rawSignals);
                const minRaw = Math.min(...rawSignals);

                if (maxRaw === minRaw) {
                    // All pre-normalization signals equal (includes the all-zero case):
                    // every Chapter is assigned 0 (Req 3.2, 3.5).
                    for (const result of results) {
                        expect(result.combinedWeightageSignal).toBe(0);
                    }
                } else {
                    // The highest pre-normalization signal -> 1, the lowest -> 0 (Req 3.2).
                    for (const result of results) {
                        if (result.rawSignal === maxRaw) {
                            expect(result.combinedWeightageSignal).toBe(1);
                        }
                        if (result.rawSignal === minRaw) {
                            expect(result.combinedWeightageSignal).toBe(0);
                        }
                    }
                }
            }),
            { numRuns: 100 },
        );
    });

    // Feature: weightage-based-time-allocation, Property 4: Combined_Weightage_Signal
    // normalizes onto [0,1]
    it('Property 4: an all-equal set (including all-zero) assigns 0 to every Chapter (Req 3.2, 3.5)', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 1, max: 12 }),
                frequencyArb,
                frequencyArb,
                (count, pyqFrequency, historicalFrequency) => {
                    // Every Chapter shares identical inputs, so all raw signals are equal.
                    const inputs: ChapterSignalInput[] = Array.from(
                        { length: count },
                        (_unused, index) => ({
                            chapterId: `ch-${index}`,
                            referenceKey: `k${String(index).padStart(2, '0')}`,
                            pyqFrequency,
                            historicalFrequency,
                            hasHistoricalData: true,
                        }),
                    );

                    const results = combinedWeightageSignal(inputs);

                    for (const result of results) {
                        expect(result.combinedWeightageSignal).toBe(0);
                    }
                },
            ),
            { numRuns: 100 },
        );
    });
});
