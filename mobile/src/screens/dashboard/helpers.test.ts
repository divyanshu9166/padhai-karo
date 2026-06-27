import {
    chapterStatusKey,
    formatIsoDate,
    formatMinutes,
    isCompletedStatus,
    nextChapterStatus,
    parseMinutesInput,
    statusLabel,
    sumFocusedMinutes,
    todayUtcDateString,
} from './helpers';

describe('dashboard helpers', () => {
    describe('nextChapterStatus (forward-only lifecycle, Req 12.1)', () => {
        it('advances along NOT_STARTED → IN_PROGRESS → DONE → REVISED', () => {
            expect(nextChapterStatus('NOT_STARTED')).toBe('IN_PROGRESS');
            expect(nextChapterStatus('IN_PROGRESS')).toBe('DONE');
            expect(nextChapterStatus('DONE')).toBe('REVISED');
        });

        it('returns null at the end of the lifecycle (REVISED)', () => {
            expect(nextChapterStatus('REVISED')).toBeNull();
        });
    });

    describe('isCompletedStatus (Req 12.4)', () => {
        it('counts only DONE and REVISED as completed', () => {
            expect(isCompletedStatus('DONE')).toBe(true);
            expect(isCompletedStatus('REVISED')).toBe(true);
            expect(isCompletedStatus('NOT_STARTED')).toBe(false);
            expect(isCompletedStatus('IN_PROGRESS')).toBe(false);
        });
    });

    describe('statusLabel', () => {
        it('maps each status to a human label', () => {
            expect(statusLabel('NOT_STARTED')).toBe('Not started');
            expect(statusLabel('IN_PROGRESS')).toBe('In progress');
            expect(statusLabel('DONE')).toBe('Done');
            expect(statusLabel('REVISED')).toBe('Revised');
        });
    });

    describe('chapterStatusKey (localization keys, Req 12.1)', () => {
        it('maps each status to its catalog key', () => {
            expect(chapterStatusKey('NOT_STARTED')).toBe('chapter.status.notStarted');
            expect(chapterStatusKey('IN_PROGRESS')).toBe('chapter.status.inProgress');
            expect(chapterStatusKey('DONE')).toBe('chapter.status.done');
            expect(chapterStatusKey('REVISED')).toBe('chapter.status.revised');
        });
    });

    describe('formatMinutes', () => {
        it('formats minutes under an hour as Ym', () => {
            expect(formatMinutes(0)).toBe('0m');
            expect(formatMinutes(45)).toBe('45m');
        });

        it('formats an hour or more as Xh Ym', () => {
            expect(formatMinutes(60)).toBe('1h 0m');
            expect(formatMinutes(150)).toBe('2h 30m');
        });

        it('clamps negatives and rounds fractions', () => {
            expect(formatMinutes(-10)).toBe('0m');
            expect(formatMinutes(90.6)).toBe('1h 31m');
            expect(formatMinutes(Number.NaN)).toBe('0m');
        });
    });

    describe('sumFocusedMinutes', () => {
        it('sums focused minutes across subjects', () => {
            expect(
                sumFocusedMinutes([
                    { focusedDurationMin: 30 },
                    { focusedDurationMin: 90 },
                ]),
            ).toBe(120);
        });

        it('returns 0 for an empty list', () => {
            expect(sumFocusedMinutes([])).toBe(0);
        });
    });

    describe('parseMinutesInput', () => {
        it('parses a non-negative integer string', () => {
            expect(parseMinutesInput('120')).toBe(120);
            expect(parseMinutesInput('0')).toBe(0);
        });

        it('returns null for empty or non-numeric input', () => {
            expect(parseMinutesInput('')).toBeNull();
            expect(parseMinutesInput('   ')).toBeNull();
            expect(parseMinutesInput('1.5')).toBeNull();
            expect(parseMinutesInput('-5')).toBeNull();
            expect(parseMinutesInput('abc')).toBeNull();
        });
    });

    describe('date helpers', () => {
        it('formats today as a UTC YYYY-MM-DD string', () => {
            expect(todayUtcDateString(new Date('2026-03-04T15:30:00.000Z'))).toBe('2026-03-04');
        });

        it('formats an ISO date string to YYYY-MM-DD and handles null/invalid', () => {
            expect(formatIsoDate('2026-05-18T00:00:00.000Z')).toBe('2026-05-18');
            expect(formatIsoDate(null)).toBe('—');
            expect(formatIsoDate('not-a-date')).toBe('—');
        });
    });
});
