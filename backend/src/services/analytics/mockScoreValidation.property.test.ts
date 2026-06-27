/**
 * Property-based test for the pure External_Mock_Score validator.
 *
 *   - Property 1 (task 4.2): External mock score validation boundaries (Req 1.2, 1.3, 1.4).
 *
 * A single fast-check assertion running the global iteration count (>= 100 in CI via
 * FC_NUM_RUNS, configured in vitest.setup.ts), placed next to the
 * {@link validateMockScoreInput} logic it validates. A fixed `now` is injected so the
 * `testDate <= now` boundary is deterministic.
 *
 * The validator must accept a candidate IF AND ONLY IF every bound holds:
 *   - `maxScore > 0` (Req 1.3),
 *   - `0 <= obtainedScore <= maxScore` (Req 1.2),
 *   - `testDate <= now` (Req 1.4), and
 *   - when `source = OTHER`, `sourceName` is a non-blank label.
 * Any input violating a bound is rejected with a `VALIDATION_ERROR` whose `details.field`
 * names the offending field. The generator covers the valid case and each boundary-violating
 * case (negative obtained, obtained > max, max <= 0, future testDate, OTHER with blank name).
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
    MOCK_SERIES_SOURCE_VALUES,
    validateMockScoreInput,
    type MockSeriesSource,
} from './mockScoreValidation';

/** A fixed reference instant so the `testDate <= now` boundary is deterministic. */
const NOW = new Date('2024-06-01T12:00:00.000Z');

describe('validateMockScoreInput properties', () => {
    // Feature: performance-analytics, Property 1: For any candidate external mock score
    // (obtainedScore, maxScore, testDate, source, sourceName), validation accepts it iff
    // maxScore > 0 and 0 <= obtainedScore <= maxScore and testDate <= now and (source ===
    // OTHER => sourceName non-blank); any input violating a bound is rejected with a
    // validation error naming the offending field.
    it('Property 1: external mock score validation boundaries (Req 1.2, 1.3, 1.4)', () => {
        fc.assert(
            fc.property(
                fc.constantFrom<MockSeriesSource>(...MOCK_SERIES_SOURCE_VALUES),
                // sourceName: absent, empty, whitespace-only, or a non-blank label.
                fc.oneof(
                    fc.constant(undefined),
                    fc.constant(''),
                    fc.constant('   '),
                    fc.string({ minLength: 1 }).map((s) => `name-${s}`),
                ),
                // maxScore: spans negative, zero, and positive (covers the max <= 0 boundary).
                fc.oneof(
                    fc.constant(0),
                    fc.double({ min: -100, max: 1000, noNaN: true }),
                ),
                // obtainedScore: spans negative and large values (covers < 0 and > max).
                fc.double({ min: -100, max: 1000, noNaN: true }),
                // testDate offset in ms relative to NOW: past, exactly now, and future.
                fc.oneof(
                    fc.constant(0),
                    fc.integer({ min: -10_000_000_000, max: 10_000_000_000 }),
                ),
                (source, sourceName, maxScore, obtainedScore, offsetMs) => {
                    const testDate = new Date(NOW.getTime() + offsetMs);
                    const result = validateMockScoreInput(
                        { source, sourceName, testDate, obtainedScore, maxScore },
                        NOW,
                    );

                    // Independently compute the expected offending field by mirroring the
                    // spec's bound predicate, in the validator's documented check order.
                    let expectedField: string | null = null;
                    if (source === 'OTHER' && (sourceName === undefined || sourceName.trim() === '')) {
                        expectedField = 'sourceName';
                    } else if (!(maxScore > 0)) {
                        expectedField = 'maxScore';
                    } else if (obtainedScore < 0 || obtainedScore > maxScore) {
                        expectedField = 'obtainedScore';
                    } else if (testDate.getTime() > NOW.getTime()) {
                        expectedField = 'testDate';
                    }

                    if (expectedField === null) {
                        // All bounds hold -> accepted, with normalized values echoed back.
                        expect(result.ok).toBe(true);
                        if (result.ok) {
                            expect(result.value.source).toBe(source);
                            expect(result.value.obtainedScore).toBe(obtainedScore);
                            expect(result.value.maxScore).toBe(maxScore);
                            expect(result.value.testDate.getTime()).toBe(testDate.getTime());
                            // OTHER carries a trimmed non-blank label; named providers carry null.
                            if (source === 'OTHER') {
                                expect(result.value.sourceName).toBe((sourceName as string).trim());
                            } else {
                                expect(result.value.sourceName).toBeNull();
                            }
                        }
                    } else {
                        // A bound is violated -> rejected, naming the offending field.
                        expect(result.ok).toBe(false);
                        if (!result.ok) {
                            expect(result.details.field).toBe(expectedField);
                        }
                    }
                },
            ),
        );
    });
});
