/**
 * Unit test for override-clear resumption in the Suggested_Time_Allocation
 * (task 15.3; design "Components and Interfaces → Pure layer → `allocation.ts`").
 *
 *   Validates: Requirements 8.4
 *
 * Req 8.4 (override-clear resumption): when a User clears a
 * Time_Allocation_Override (or Weightage_Override), the affected Chapter resumes
 * the system suggestion on the next generation — a signal-based
 * (`COMBINED_SIGNAL`) share when it has data, or the `Chapter_Weightage`
 * fallback (`WEIGHTAGE_FALLBACK`) otherwise — and is no longer labeled
 * `USER_OVERRIDE`.
 *
 * `suggestedTimeAllocation` is pure and database-free, so "the next generation"
 * is modeled simply by calling the function a second time with the *same* inputs
 * except the override cleared to `null`. The before/after comparison demonstrates
 * resumption directly: with the override present the Chapter keeps its stored
 * share verbatim labeled `USER_OVERRIDE`; with it cleared the share is recomputed
 * from the Chapter's signal/weightage and the source is no longer `USER_OVERRIDE`.
 */
import { describe, expect, it } from 'vitest';

import {
    suggestedTimeAllocation,
    type SuggestedChapterInput,
} from './allocation';

/**
 * Two pending Chapters that both carry data (positive PYQ frequency, a
 * historical record, and a strictly positive `combinedWeightageSignal`) so the
 * non-overridden distribution is signal-based (`COMBINED_SIGNAL`). The first
 * Chapter additionally carries the supplied Time_Allocation_Override.
 */
function buildSignalInputs(
    override: number | null,
): SuggestedChapterInput[] {
    return [
        {
            chapterId: 'ch-a',
            referenceKey: 'a01',
            pyqFrequency: 10,
            historicalFrequency: 8,
            hasHistoricalData: true,
            rawSignal: 9,
            combinedWeightageSignal: 1,
            status: 'NOT_STARTED',
            weightage: 5,
            weightageIsDefault: false,
            timeAllocationOverride: override,
        },
        {
            chapterId: 'ch-b',
            referenceKey: 'b01',
            pyqFrequency: 4,
            historicalFrequency: 2,
            hasHistoricalData: true,
            rawSignal: 3,
            combinedWeightageSignal: 0.25,
            status: 'IN_PROGRESS',
            weightage: 5,
            weightageIsDefault: false,
            timeAllocationOverride: null,
        },
    ];
}

/**
 * Two pending Chapters that are both *data-less* (zero PYQ frequency, no
 * historical record, zero combined signal) so the non-overridden distribution
 * falls back to `Chapter_Weightage` (`WEIGHTAGE_FALLBACK`). The first Chapter
 * additionally carries the supplied Time_Allocation_Override.
 */
function buildFallbackInputs(
    override: number | null,
): SuggestedChapterInput[] {
    return [
        {
            chapterId: 'ch-a',
            referenceKey: 'a01',
            pyqFrequency: 0,
            historicalFrequency: 0,
            hasHistoricalData: false,
            rawSignal: 0,
            combinedWeightageSignal: 0,
            status: 'NOT_STARTED',
            weightage: 6,
            weightageIsDefault: true,
            timeAllocationOverride: override,
        },
        {
            chapterId: 'ch-b',
            referenceKey: 'b01',
            pyqFrequency: 0,
            historicalFrequency: 0,
            hasHistoricalData: false,
            rawSignal: 0,
            combinedWeightageSignal: 0,
            status: 'IN_PROGRESS',
            weightage: 2,
            weightageIsDefault: true,
            timeAllocationOverride: null,
        },
    ];
}

describe('suggestedTimeAllocation override-clear resumption (Req 8.4)', () => {
    it('honors a present Time_Allocation_Override as USER_OVERRIDE', () => {
        const result = suggestedTimeAllocation(buildSignalInputs(0.3));
        const chA = result.find((s) => s.chapterId === 'ch-a');

        // With the override present the Chapter keeps its stored share verbatim.
        expect(chA?.source).toBe('USER_OVERRIDE');
        expect(chA?.allocationShare).toBe(0.3);
    });

    it('resumes the signal-based suggestion (COMBINED_SIGNAL) when the override is cleared', () => {
        const withOverride = suggestedTimeAllocation(buildSignalInputs(0.3));
        const cleared = suggestedTimeAllocation(buildSignalInputs(null));

        const beforeA = withOverride.find((s) => s.chapterId === 'ch-a');
        const afterA = cleared.find((s) => s.chapterId === 'ch-a');

        // Sanity: the only difference between the two generations is the override.
        expect(beforeA?.source).toBe('USER_OVERRIDE');
        expect(beforeA?.allocationShare).toBe(0.3);

        // After clearing, the Chapter is no longer a USER_OVERRIDE...
        expect(afterA?.source).not.toBe('USER_OVERRIDE');
        // ...it resumes a signal-based share.
        expect(afterA?.source).toBe('COMBINED_SIGNAL');

        // The recomputed share matches the signal proportion (1 / (1 + 0.25) = 0.8),
        // and is different from the prior 0.3 override — it was genuinely recomputed.
        expect(afterA?.allocationShare).toBeCloseTo(0.8, 4);
        expect(afterA?.allocationShare).not.toBe(0.3);

        // The full set still sums to 1.0 within tolerance on the next generation.
        const total = cleared.reduce((sum, s) => sum + s.allocationShare, 0);
        expect(total).toBeCloseTo(1, 3);
    });

    it('resumes the Chapter_Weightage fallback (WEIGHTAGE_FALLBACK) when a data-less override is cleared', () => {
        const withOverride = suggestedTimeAllocation(buildFallbackInputs(0.3));
        const cleared = suggestedTimeAllocation(buildFallbackInputs(null));

        const beforeA = withOverride.find((s) => s.chapterId === 'ch-a');
        const afterA = cleared.find((s) => s.chapterId === 'ch-a');

        // With the override present it is honored verbatim regardless of data.
        expect(beforeA?.source).toBe('USER_OVERRIDE');
        expect(beforeA?.allocationShare).toBe(0.3);

        // After clearing, a data-less Chapter resumes the weightage fallback.
        expect(afterA?.source).not.toBe('USER_OVERRIDE');
        expect(afterA?.source).toBe('WEIGHTAGE_FALLBACK');

        // Recomputed by Chapter_Weightage proportion (6 / (6 + 2) = 0.75).
        expect(afterA?.allocationShare).toBeCloseTo(0.75, 4);

        const total = cleared.reduce((sum, s) => sum + s.allocationShare, 0);
        expect(total).toBeCloseTo(1, 3);
    });
});
