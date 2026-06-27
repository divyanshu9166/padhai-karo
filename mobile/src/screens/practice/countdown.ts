/**
 * Pure Timed Paper Mode countdown logic (task 21.6; Req 19.1, 19.3).
 *
 * The countdown that runs over a full paper is extracted from {@link TimedPaperScreen} as a
 * set of small, dependency-free functions so the "auto-submit the instant the timer reaches
 * zero" rule (Req 19.3) and the elapsed-time accounting are trivially unit-testable without
 * React or real timers. The screen owns the remaining-seconds React state and a 1s interval;
 * it delegates every calculation here.
 *
 * Seconds are the unit throughout: a paper's standard duration is given in minutes
 * (`durationMin`) and converted once via {@link initialRemainingSec}; the attempt records the
 * elapsed `timeTakenSec` computed by {@link elapsedSec}.
 */

/** The countdown's starting seconds for a paper of `durationMin` minutes (never negative). */
export function initialRemainingSec(durationMin: number): number {
    if (!Number.isFinite(durationMin) || durationMin <= 0) {
        return 0;
    }
    return Math.max(0, Math.round(durationMin * 60));
}

/** Advance the countdown by one tick, clamping at zero so it never goes negative (Req 19.1). */
export function tick(remainingSec: number): number {
    return remainingSec > 0 ? remainingSec - 1 : 0;
}

/** Whether the countdown has reached zero and the paper must auto-submit (Req 19.3). */
export function isExpired(remainingSec: number): boolean {
    return remainingSec <= 0;
}

/**
 * The elapsed `timeTakenSec` for the attempt: the standard duration minus whatever is left on
 * the clock, clamped to `[0, totalSec]`. At auto-submit (`remainingSec === 0`) this equals the
 * full duration; on an early manual submit it is the time actually spent (Req 19.3 vs manual).
 */
export function elapsedSec(durationMin: number, remainingSec: number): number {
    const totalSec = initialRemainingSec(durationMin);
    const safeRemaining = Math.max(0, Math.min(remainingSec, totalSec));
    return totalSec - safeRemaining;
}

/** Format a non-negative second count as `mm:ss` (or `hh:mm:ss` past an hour) for display. */
export function formatClock(totalSeconds: number): string {
    const s = Math.max(0, Math.floor(totalSeconds));
    const hours = Math.floor(s / 3600);
    const minutes = Math.floor((s % 3600) / 60);
    const seconds = s % 60;
    const pad = (n: number): string => String(n).padStart(2, '0');
    return hours > 0 ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}
