import { describe, expect, it } from 'vitest';

import {
    createTimer,
    focusedMinutes,
    focusedMs,
    formatDuration,
    pause,
    resume,
    start,
    stop,
} from './timing';

/**
 * Unit tests for the pure focus-timer timing logic (task 21.4).
 *
 * Focus is on the "paused time is excluded from the focused duration" rule (Req 4.2) and the
 * stop result the record endpoint consumes (Req 4.5).
 */
describe('focus timer timing', () => {
    const T0 = 1_000_000; // arbitrary epoch-ms baseline

    it('counts running time toward the focused duration (Req 4.1)', () => {
        const running = start(createTimer(), T0);
        // 90s later, still running
        expect(focusedMs(running, T0 + 90_000)).toBe(90_000);
        expect(focusedMinutes(running, T0 + 90_000)).toBe(1);
    });

    it('excludes paused wall-clock time from the focused duration (Req 4.2)', () => {
        // Run 60s, pause for 300s, resume and run another 60s.
        let s = start(createTimer(), T0);
        s = pause(s, T0 + 60_000); // 60s focused, then paused
        // While paused, focused total stays frozen regardless of elapsed wall-clock.
        expect(focusedMs(s, T0 + 60_000 + 300_000)).toBe(60_000);
        s = resume(s, T0 + 360_000); // resume after a 5-minute pause
        // Another 60s of running.
        expect(focusedMs(s, T0 + 420_000)).toBe(120_000);
    });

    it('focused duration is independent of how long the timer was paused (Req 4.2)', () => {
        // Two sessions with IDENTICAL running segments (60s + 60s) but very different pause
        // lengths must yield the same focused duration: paused wall-clock time is excluded.
        const runForSession = (pauseMs: number): number => {
            let s = start(createTimer(), T0);
            s = pause(s, T0 + 60_000); // first 60s of focus
            s = resume(s, T0 + 60_000 + pauseMs); // pause of arbitrary length, then resume
            const stopped = stop(s, T0 + 60_000 + pauseMs + 60_000); // second 60s of focus
            return stopped!.focusedMs;
        };

        const shortPause = runForSession(1_000); // 1s pause
        const longPause = runForSession(3_600_000); // 1h pause
        expect(shortPause).toBe(120_000);
        expect(longPause).toBe(120_000);
        expect(shortPause).toBe(longPause);
    });

    it('produces a stop result with wall-clock span and paused-excluded focused time (Req 4.2/4.5)', () => {
        let s = start(createTimer(), T0);
        s = pause(s, T0 + 120_000); // 120s focused
        s = resume(s, T0 + 600_000); // 8-minute pause excluded
        const stopped = stop(s, T0 + 660_000); // +60s focused → 180s total
        expect(stopped).not.toBeNull();
        expect(stopped?.startedAt).toBe(T0);
        expect(stopped?.endedAt).toBe(T0 + 660_000);
        expect(stopped?.focusedMs).toBe(180_000);
        expect(stopped?.focusedMinutes).toBe(3);
        // Focused duration is never greater than the elapsed wall-clock (Req 4.5 invariant).
        const wallClockMs = (stopped!.endedAt - stopped!.startedAt);
        expect(stopped!.focusedMs).toBeLessThanOrEqual(wallClockMs);
    });

    it('returns null when stopping a timer that was never started', () => {
        expect(stop(createTimer(), T0)).toBeNull();
    });

    it('ignores invalid transitions (start while running, resume while running, pause while idle)', () => {
        const running = start(createTimer(), T0);
        expect(start(running, T0 + 5_000)).toBe(running); // no restart mid-run
        expect(resume(running, T0 + 5_000)).toBe(running); // already running
        expect(pause(createTimer(), T0)).toEqual(createTimer()); // nothing to pause
    });

    it('formats durations as MM:SS and HH:MM:SS', () => {
        expect(formatDuration(0)).toBe('00:00');
        expect(formatDuration(65_000)).toBe('01:05');
        expect(formatDuration(3_661_000)).toBe('01:01:01');
    });
});
