import { describe, expect, it } from 'vitest';

import {
    chaptersHandler,
    examDateHandler,
    parseTrackParam,
    parseYearParam,
    subjectsHandler,
} from './referenceService';
import { EXAM_TRACKS, getChapters, getExamDate, getSubjects } from '@/lib/reference';
import type { ExamTrack } from '@/lib/reference';

/**
 * Example tests for the Reference Data Service read endpoints (task 3.2).
 *
 * These exercise the handlers directly with plain `Request` objects — no running server
 * or database needed, since the catalog is in-memory. They validate the core logic:
 * valid track returns subjects/chapters, invalid/missing track -> 422, and the
 * exam-date present/absent paths.
 *
 * Validates: Requirements 2.7, 11.1, 12.6, 14.6
 */

const BASE = 'http://localhost/api/reference';

function get(path: string): Request {
    return new Request(`${BASE}${path}`);
}

describe('GET /reference/subjects', () => {
    it.each(EXAM_TRACKS)('returns the subjects for track %s (Req 2.7, 11.1)', async (track) => {
        const res = subjectsHandler(get(`/subjects?track=${track}`));
        expect(res.status).toBe(200);

        const body = (await res.json()) as { subjects: ReturnType<typeof getSubjects> };
        expect(body.subjects.map((s) => s.name)).toEqual(getSubjects(track).map((s) => s.name));
        // Every returned subject belongs to the requested track.
        expect(body.subjects.every((s) => s.examTrack === track)).toBe(true);
    });

    it('rejects a missing track with 422 VALIDATION_ERROR', async () => {
        const res = subjectsHandler(get('/subjects'));
        expect(res.status).toBe(422);
        const body = (await res.json()) as { error: { code: string } };
        expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects an unrecognized track with 422 VALIDATION_ERROR', async () => {
        const res = subjectsHandler(get('/subjects?track=SAT'));
        expect(res.status).toBe(422);
        const body = (await res.json()) as { error: { code: string; details?: unknown } };
        expect(body.error.code).toBe('VALIDATION_ERROR');
    });
});

describe('GET /reference/chapters', () => {
    it.each(EXAM_TRACKS)(
        'returns chapters annotated with subject key/name for track %s (Req 12.6)',
        async (track) => {
            const res = chaptersHandler(get(`/chapters?track=${track}`));
            expect(res.status).toBe(200);

            const body = (await res.json()) as { chapters: ReturnType<typeof getChapters> };
            const expected = getChapters(track);
            expect(body.chapters).toHaveLength(expected.length);
            // Subject annotations are present on every chapter.
            expect(
                body.chapters.every(
                    (c) =>
                        typeof c.subjectKey === 'string' &&
                        c.subjectKey.length > 0 &&
                        typeof c.subjectName === 'string' &&
                        c.subjectName.length > 0 &&
                        c.estimatedStudyHours > 0,
                ),
            ).toBe(true);
        },
    );

    it('rejects an invalid track with 422', async () => {
        const res = chaptersHandler(get('/chapters?track=jee')); // case-sensitive: not allowed
        expect(res.status).toBe(422);
    });
});

describe('GET /reference/exam-date', () => {
    it('returns the target exam date for a known track/year (Req 14.6)', async () => {
        const track: ExamTrack = 'JEE';
        const year = 2026;
        const res = examDateHandler(get(`/exam-date?track=${track}&year=${year}`));
        expect(res.status).toBe(200);

        const body = (await res.json()) as { targetExamDate: string };
        expect(body.targetExamDate).toBe(getExamDate(track, year)!.toISOString());
    });

    it('returns 404 NOT_FOUND when no date exists for the track/year', async () => {
        const res = examDateHandler(get('/exam-date?track=JEE&year=1900'));
        expect(res.status).toBe(404);
        const body = (await res.json()) as { error: { code: string } };
        expect(body.error.code).toBe('NOT_FOUND');
    });

    it('rejects a missing track with 422', async () => {
        const res = examDateHandler(get('/exam-date?year=2026'));
        expect(res.status).toBe(422);
    });

    it('rejects a missing year with 422', async () => {
        const res = examDateHandler(get('/exam-date?track=NEET'));
        expect(res.status).toBe(422);
    });

    it.each(['2026.5', 'abc', '', '0x7e0'])(
        'rejects a non-integer year %j with 422',
        async (year) => {
            const res = examDateHandler(get(`/exam-date?track=NEET&year=${encodeURIComponent(year)}`));
            expect(res.status).toBe(422);
        },
    );
});

describe('parseTrackParam / parseYearParam helpers', () => {
    it('accepts every allowed track', () => {
        for (const track of EXAM_TRACKS) {
            const parsed = parseTrackParam(new URL(`${BASE}/subjects?track=${track}`));
            expect(parsed.ok).toBe(true);
        }
    });

    it('accepts a canonical integer year', () => {
        const parsed = parseYearParam(new URL(`${BASE}/exam-date?year=2027`));
        expect(parsed.ok).toBe(true);
        if (parsed.ok) {
            expect(parsed.year).toBe(2027);
        }
    });
});
