/**
 * Morning study nudge: when to send it and what it says.
 *
 * The notifications cron runs every 15 minutes. A student gets at most one nudge per India
 * day, only inside the morning window (06:30–09:30 IST), and never inside the quiet hours
 * they set in notification preferences. The message leads with what matters most today:
 * due revision cards first, then the daily quiz and the streak it protects.
 */
import type { LanguagePref } from '@prisma/client';

const IST_OFFSET_MIN = 5 * 60 + 30;
export const MORNING_WINDOW = { startMin: 6 * 60 + 30, endMin: 9 * 60 + 30 } as const;

/** Minutes since midnight in India time. */
export function indiaMinuteOfDay(now: Date): number {
    return (now.getUTCHours() * 60 + now.getUTCMinutes() + IST_OFFSET_MIN) % (24 * 60);
}

/** Start of the current India calendar day as a UTC instant. */
export function startOfIndiaDay(now: Date): Date {
    const minutes = indiaMinuteOfDay(now);
    const start = new Date(now.getTime() - minutes * 60_000);
    start.setUTCSeconds(0, 0);
    return start;
}

function parseHhMm(value: string | null | undefined): number | null {
    const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value?.trim() ?? '');
    return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

/** True when `minute` falls inside the quiet window, including windows that wrap midnight. */
export function inQuietHours(minute: number, quietStart: string | null | undefined, quietEnd: string | null | undefined): boolean {
    const start = parseHhMm(quietStart);
    const end = parseHhMm(quietEnd);
    if (start === null || end === null || start === end) return false;
    return start < end ? minute >= start && minute < end : minute >= start || minute < end;
}

export function isNudgeTime(now: Date, quietStart?: string | null, quietEnd?: string | null): boolean {
    const minute = indiaMinuteOfDay(now);
    return minute >= MORNING_WINDOW.startMin && minute < MORNING_WINDOW.endMin && !inQuietHours(minute, quietStart, quietEnd);
}

export interface NudgeInput {
    dueCards: number;
    quizAvailable: boolean;
    quizDoneToday: boolean;
    streak: number;
    language: LanguagePref;
}

export interface NudgeMessage {
    title: string;
    body: string;
    data: Record<string, unknown>;
}

/** Build the nudge, or `null` when there is nothing useful to say today. */
export function buildMorningNudge(input: NudgeInput): NudgeMessage | null {
    const hindi = input.language === 'HI';
    const quizPending = input.quizAvailable && !input.quizDoneToday;
    const streakLine = input.streak > 0
        ? hindi ? ` आपकी ${input.streak} दिन की streak जारी रखें।` : ` Keep your ${input.streak}-day streak going.`
        : '';

    if (input.dueCards > 0) {
        const cards = hindi
            ? input.dueCards === 1 ? '1 revision card आज due है।' : `${input.dueCards} revision cards आज due हैं।`
            : input.dueCards === 1 ? '1 revision card is due today.' : `${input.dueCards} revision cards are due today.`;
        const quiz = quizPending ? (hindi ? ' आज का 10-प्रश्न quiz भी तैयार है।' : " Today's 10-question quiz is ready too.") : '';
        return {
            title: hindi ? 'सुबह का revision' : 'Morning revision',
            body: `${cards}${quiz}${streakLine}`,
            data: { route: 'Revision', dueCount: input.dueCards },
        };
    }

    if (quizPending) {
        return {
            title: hindi ? 'आज का Daily Quiz' : "Today's Daily Quiz",
            body: `${hindi ? '10 PYQ प्रश्न, लगभग 10 मिनट।' : '10 PYQs, about 10 minutes.'}${streakLine}`,
            data: { route: 'DailyQuiz' },
        };
    }

    return null;
}
