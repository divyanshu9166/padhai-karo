/**
 * Date helpers for the timetable screen (task 21.3).
 *
 * The Backend_API keys timetables by a `weekStart` it normalizes to UTC-midnight, and groups
 * blocks by their absolute `startTime`. These helpers compute the current/adjacent week starts
 * and format block times for display, all in UTC so the client's grouping matches the server's
 * day boundaries (the generator builds the grid in UTC).
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Weekday labels indexed by `Date.getUTCDay()` (0 = Sunday). */
const WEEKDAY_LABELS = [
    'Sunday',
    'Monday',
    'Tuesday',
    'Wednesday',
    'Thursday',
    'Friday',
    'Saturday',
] as const;

/** Truncate a date to UTC midnight. */
export function startOfUtcDay(date: Date): Date {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/**
 * The UTC-midnight Monday on or before `reference` (defaults to now), as an ISO string. The
 * generator builds a 7-day week from this start, so anchoring on Monday gives a stable week.
 */
export function currentWeekStartIso(reference: Date = new Date()): string {
    const day = startOfUtcDay(reference);
    const dow = day.getUTCDay(); // 0 = Sunday … 6 = Saturday
    const deltaToMonday = (dow + 6) % 7; // days since the most recent Monday
    return new Date(day.getTime() - deltaToMonday * MS_PER_DAY).toISOString();
}

/** Shift an ISO weekStart by a whole number of weeks (negative = earlier). */
export function shiftWeekIso(weekStartIso: string, deltaWeeks: number): string {
    return new Date(new Date(weekStartIso).getTime() + deltaWeeks * 7 * MS_PER_DAY).toISOString();
}

/** ISO string of the last (7th) UTC day of the week beginning at `weekStartIso`. */
export function weekEndIso(weekStartIso: string): string {
    return new Date(new Date(weekStartIso).getTime() + 6 * MS_PER_DAY).toISOString();
}

/** A short `1–7 Jun` style label for the week beginning at `weekStartIso` (UTC). */
export function formatWeekRange(weekStartIso: string): string {
    const start = new Date(weekStartIso);
    const end = new Date(weekEndIso(weekStartIso));
    return `${formatDayMonth(start)} – ${formatDayMonth(end)}`;
}

/** `1 Jun` style day+month (UTC). */
export function formatDayMonth(date: Date): string {
    const months = [
        'Jan',
        'Feb',
        'Mar',
        'Apr',
        'May',
        'Jun',
        'Jul',
        'Aug',
        'Sep',
        'Oct',
        'Nov',
        'Dec',
    ] as const;
    return `${date.getUTCDate()} ${months[date.getUTCMonth()]}`;
}

/** Weekday name for an ISO timestamp (UTC), e.g. "Monday". */
export function weekdayLabel(iso: string): string {
    return WEEKDAY_LABELS[new Date(iso).getUTCDay()] ?? 'Unknown';
}

/** A `Monday, 1 Jun` heading for grouping blocks by day (UTC). */
export function dayHeading(iso: string): string {
    return `${weekdayLabel(iso)}, ${formatDayMonth(new Date(iso))}`;
}

/** A UTC `HH:MM` clock label for an ISO timestamp. */
export function formatClock(iso: string): string {
    const date = new Date(iso);
    const hh = String(date.getUTCHours()).padStart(2, '0');
    const mm = String(date.getUTCMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
}

/** A `HH:MM – HH:MM` range for a block starting at `startIso` lasting `durationMin` minutes. */
export function formatTimeRange(startIso: string, durationMin: number): string {
    const start = new Date(startIso);
    const end = new Date(start.getTime() + durationMin * 60 * 1000);
    return `${formatClock(start.toISOString())} – ${formatClock(end.toISOString())}`;
}

/** A UTC day key (`YYYY-MM-DD`) used to group blocks; stable for sorting. */
export function dayKey(iso: string): string {
    return new Date(iso).toISOString().slice(0, 10);
}
