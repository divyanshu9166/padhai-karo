export type ReviewRating = 1 | 2 | 3 | 4;

export interface ReviewState {
    intervalDays: number;
    ease: number;
    repetitions: number;
    lapses: number;
}

export interface ReviewSchedule {
    intervalDays: number;
    ease: number;
    repetitions: number;
    lapses: number;
    dueAt: Date;
}

const FIRST_INTERVALS = [1, 3, 7, 21] as const;

/**
 * Deterministic spaced-repetition scheduler. The first four successful reviews
 * follow +1/+3/+7/+21; later reviews use an SM-2 style ease factor.
 */
export function scheduleNextReview(
    state: ReviewState,
    rating: ReviewRating,
    now = new Date(),
): ReviewSchedule {
    const safeEase = Number.isFinite(state.ease) ? Math.min(3.2, Math.max(1.3, state.ease)) : 2.5;
    const currentRepetitions = Math.max(0, Math.floor(state.repetitions));
    const currentLapses = Math.max(0, Math.floor(state.lapses));

    if (rating === 1) {
        return {
            intervalDays: 1,
            ease: Math.max(1.3, safeEase - 0.2),
            repetitions: 0,
            lapses: currentLapses + 1,
            dueAt: addDays(now, 1),
        };
    }

    const nextRepetitions = currentRepetitions + 1;
    const nextInterval = FIRST_INTERVALS[nextRepetitions - 1] ??
        Math.max(21, Math.round(Math.max(1, state.intervalDays) * (rating === 4 ? safeEase + 0.35 : safeEase)));
    const nextEase = Math.min(3.2, Math.max(1.3, safeEase + (rating === 4 ? 0.15 : rating === 2 ? -0.15 : 0)));
    const intervalDays = rating === 2 ? Math.max(1, Math.round(nextInterval * 0.65)) : nextInterval;

    return {
        intervalDays,
        ease: nextEase,
        repetitions: nextRepetitions,
        lapses: currentLapses,
        dueAt: addDays(now, intervalDays),
    };
}

function addDays(date: Date, days: number): Date {
    const next = new Date(date);
    next.setUTCDate(next.getUTCDate() + days);
    return next;
}
