/**
 * Pomodoro focus-timer timing logic (task 21.4; Req 4.1, 4.2, 4.5).
 *
 * Timing happens entirely on-device; the Backend_API only validates and persists the
 * recorded session (see design "Focus Timer / Session Service"). This module is a small,
 * dependency-free state machine extracted from the screen so the "pause excludes elapsed
 * time" rule (Req 4.2) is a pure function that task 21.10 can unit-test without React.
 *
 * The key idea: focused time is the SUM of running segments only. We keep the focused
 * milliseconds accrued from already-completed segments in `accumulatedMs`, plus — while the
 * timer is currently running — the open segment since `lastResumeAt`. Pausing closes the
 * open segment into `accumulatedMs` and clears `lastResumeAt`, so wall-clock time that
 * passes while paused is never counted (Req 4.2). Resuming opens a fresh segment.
 */

/** The lifecycle state of the on-device timer. */
export type TimerStatus = 'idle' | 'running' | 'paused';

/**
 * Immutable timer state. All transitions return a new object so the screen can hold this in
 * React state and the logic stays trivially testable.
 */
export interface TimerState {
    status: TimerStatus;
    /** Wall-clock session start (epoch ms); `null` until the timer is first started. */
    startedAt: number | null;
    /** Focused ms accrued from completed (paused/closed) running segments. */
    accumulatedMs: number;
    /** Epoch ms when the current running segment began; `null` when not running. */
    lastResumeAt: number | null;
}

/** A fresh, unstarted timer. */
export function createTimer(): TimerState {
    return { status: 'idle', startedAt: null, accumulatedMs: 0, lastResumeAt: null };
}

/**
 * Start a fresh session at `now`. Resets any prior accrual so a new run begins at zero.
 * No-op (returns the input) if the timer is already running or paused — callers stop first.
 */
export function start(state: TimerState, now: number): TimerState {
    if (state.status !== 'idle') {
        return state;
    }
    return { status: 'running', startedAt: now, accumulatedMs: 0, lastResumeAt: now };
}

/**
 * Pause a running timer at `now`, closing the open running segment into `accumulatedMs`.
 * While paused the focused total stays frozen, so the paused span is excluded (Req 4.2).
 * No-op when not currently running.
 */
export function pause(state: TimerState, now: number): TimerState {
    if (state.status !== 'running' || state.lastResumeAt === null) {
        return state;
    }
    const segment = Math.max(0, now - state.lastResumeAt);
    return {
        ...state,
        status: 'paused',
        accumulatedMs: state.accumulatedMs + segment,
        lastResumeAt: null,
    };
}

/** Resume a paused timer at `now`, opening a new running segment. No-op when not paused. */
export function resume(state: TimerState, now: number): TimerState {
    if (state.status !== 'paused') {
        return state;
    }
    return { ...state, status: 'running', lastResumeAt: now };
}

/**
 * The focused milliseconds as of `now`: completed segments plus the open running segment
 * (only when running). While paused or idle this returns just `accumulatedMs`, so paused
 * wall-clock time is never included (Req 4.2).
 */
export function focusedMs(state: TimerState, now: number): number {
    if (state.status === 'running' && state.lastResumeAt !== null) {
        return state.accumulatedMs + Math.max(0, now - state.lastResumeAt);
    }
    return state.accumulatedMs;
}

/** Whole focused minutes (floored), as the Backend_API stores an integer `focusedDurationMin`. */
export function focusedMinutes(state: TimerState, now: number): number {
    return Math.floor(focusedMs(state, now) / 60_000);
}

/** The result of stopping a timer: the values the record endpoint needs. */
export interface StoppedSession {
    /** Wall-clock start (epoch ms). */
    startedAt: number;
    /** Wall-clock end (epoch ms) — i.e. `now` at stop. */
    endedAt: number;
    /** Accumulated focused milliseconds, excluding paused spans (Req 4.2). */
    focusedMs: number;
    /** Whole focused minutes (floored) for `focusedDurationMin` (Req 4.5). */
    focusedMinutes: number;
}

/**
 * Stop the timer at `now`, returning the wall-clock span and the accumulated focused time.
 * Returns `null` when the timer was never started (nothing to record).
 */
export function stop(state: TimerState, now: number): StoppedSession | null {
    if (state.startedAt === null) {
        return null;
    }
    const ms = focusedMs(state, now);
    return {
        startedAt: state.startedAt,
        endedAt: now,
        focusedMs: ms,
        focusedMinutes: Math.floor(ms / 60_000),
    };
}

/** Format a millisecond duration as `MM:SS` (or `HH:MM:SS` past an hour) for display. */
export function formatDuration(ms: number): string {
    const totalSeconds = Math.floor(Math.max(0, ms) / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const pad = (n: number): string => n.toString().padStart(2, '0');
    return hours > 0 ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}
