import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    deviceFindMany: vi.fn(),
    deviceUpdateMany: vi.fn(),
    prefFind: vi.fn(),
    cardCount: vi.fn(),
    profileFind: vi.fn(),
    quizFindMany: vi.fn(),
    pyqCount: vi.fn(),
}));

vi.mock('@/lib/db', () => {
    const prisma = {
        pushDevice: { findMany: mocks.deviceFindMany, updateMany: mocks.deviceUpdateMany },
        notificationPreference: { findUnique: mocks.prefFind },
        revisionCard: { count: mocks.cardCount },
        profile: { findUnique: mocks.profileFind },
        dailyQuizAttempt: { findMany: mocks.quizFindMany },
        pYQ: { count: mocks.pyqCount },
    };
    return { prisma, default: prisma };
});

import { buildMorningNudge, inQuietHours, indiaMinuteOfDay, isNudgeTime, startOfIndiaDay } from './morningNudge';
import { sendScheduledRevisionRemindersHandler } from './pushService';

// 02:00 UTC = 07:30 IST (inside the morning window).
const MORNING = new Date('2026-09-25T02:00:00.000Z');
// 21:30 UTC = 03:00 IST (the old 18-hour cursor could send at this hour).
const NIGHT = new Date('2026-09-24T21:30:00.000Z');

const fetchMock = vi.fn();

beforeEach(() => {
    vi.clearAllMocks();
    process.env.PUSH_CRON_SECRET = 'cron-secret';
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ data: [{ status: 'ok' }] }), { status: 200 }));
    mocks.deviceFindMany.mockResolvedValue([{ id: 'd1', userId: 'u1', expoPushToken: 'ExponentPushToken[abc]' }]);
    mocks.deviceUpdateMany.mockResolvedValue({ count: 1 });
    mocks.prefFind.mockResolvedValue(null);
    mocks.cardCount.mockResolvedValue(0);
    mocks.profileFind.mockResolvedValue({ language: 'EN', examTrack: 'UPSC', examProgram: 'UPSC_CSE', examStage: 'PRELIMS' });
    mocks.quizFindMany.mockResolvedValue([{ quizDate: '2026-09-24' }, { quizDate: '2026-09-23' }]);
    mocks.pyqCount.mockResolvedValue(100);
});

function cron(): Request {
    return new Request('https://api.test/api/notifications/cron', { method: 'POST', headers: { 'x-push-cron-secret': 'cron-secret' } });
}

describe('timing helpers', () => {
    it('converts to India time', () => {
        expect(indiaMinuteOfDay(MORNING)).toBe(7 * 60 + 30);
        expect(indiaMinuteOfDay(NIGHT)).toBe(3 * 60);
        expect(startOfIndiaDay(MORNING).toISOString()).toBe('2026-09-24T18:30:00.000Z');
    });

    it('handles quiet hours that wrap midnight', () => {
        expect(inQuietHours(23 * 60, '22:00', '07:00')).toBe(true);
        expect(inQuietHours(6 * 60, '22:00', '07:00')).toBe(true);
        expect(inQuietHours(8 * 60, '22:00', '07:00')).toBe(false);
        expect(inQuietHours(8 * 60, 'bad', '07:00')).toBe(false);
    });

    it('only allows the morning window outside quiet hours', () => {
        expect(isNudgeTime(MORNING)).toBe(true);
        expect(isNudgeTime(NIGHT)).toBe(false);
        expect(isNudgeTime(MORNING, '07:00', '08:00')).toBe(false);
    });
});

describe('buildMorningNudge', () => {
    it('leads with due revision and mentions the quiz and streak', () => {
        const nudge = buildMorningNudge({ dueCards: 4, quizAvailable: true, quizDoneToday: false, streak: 3, language: 'EN' });
        expect(nudge?.body).toBe("4 revision cards are due today. Today's 10-question quiz is ready too. Keep your 3-day streak going.");
        expect(nudge?.data.route).toBe('Revision');
    });

    it('sends the quiz nudge when nothing is due', () => {
        expect(buildMorningNudge({ dueCards: 0, quizAvailable: true, quizDoneToday: false, streak: 0, language: 'EN' })?.data.route).toBe('DailyQuiz');
    });

    it('stays silent when there is nothing to do', () => {
        expect(buildMorningNudge({ dueCards: 0, quizAvailable: true, quizDoneToday: true, streak: 5, language: 'EN' })).toBeNull();
        expect(buildMorningNudge({ dueCards: 0, quizAvailable: false, quizDoneToday: false, streak: 0, language: 'EN' })).toBeNull();
    });

    it('writes Hindi for Hindi-preference students', () => {
        const nudge = buildMorningNudge({ dueCards: 1, quizAvailable: false, quizDoneToday: false, streak: 2, language: 'HI' });
        expect(nudge?.title).toBe('सुबह का revision');
        expect(nudge?.body).toContain('2 दिन की streak');
    });
});

describe('scheduled morning nudge', () => {
    it('does nothing outside the morning window', async () => {
        const body = await (await sendScheduledRevisionRemindersHandler(cron(), NIGHT)).json();
        expect(body.skipped).toBe('outside-morning-window');
        expect(mocks.deviceFindMany).not.toHaveBeenCalled();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('sends once per India day with the streak in the message', async () => {
        const body = await (await sendScheduledRevisionRemindersHandler(cron(), MORNING)).json();
        expect(body.usersNotified).toBe(1);
        expect(mocks.deviceFindMany.mock.calls[0]![0].where.OR[1]).toEqual({ lastRevisionReminderAt: { lt: new Date('2026-09-24T18:30:00.000Z') } });
        const sent = JSON.parse(fetchMock.mock.calls[0]![1].body)[0];
        expect(sent.body).toContain('2-day streak');
        expect(mocks.deviceUpdateMany).toHaveBeenCalledWith({ where: { id: { in: ['d1'] } }, data: { lastRevisionReminderAt: MORNING } });
    });

    it('respects quiet hours and disabled reminders', async () => {
        mocks.prefFind.mockResolvedValueOnce({ revisionReminders: true, quietStart: '07:00', quietEnd: '08:00' });
        expect((await (await sendScheduledRevisionRemindersHandler(cron(), MORNING)).json()).usersNotified).toBe(0);
        mocks.prefFind.mockResolvedValueOnce({ revisionReminders: false, quietStart: null, quietEnd: null });
        expect((await (await sendScheduledRevisionRemindersHandler(cron(), MORNING)).json()).usersNotified).toBe(0);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('rejects a missing cron secret', async () => {
        const response = await sendScheduledRevisionRemindersHandler(new Request('https://api.test/x', { method: 'POST' }), MORNING);
        expect(response.status).toBe(403);
    });
});
