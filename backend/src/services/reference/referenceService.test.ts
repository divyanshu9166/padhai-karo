import { describe, expect, it } from 'vitest';

import {
    chaptersHandler,
    examDateHandler,
    examProgramsHandler,
    parseExamFamilyParam,
    parseExamProgramParam,
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

    it('returns stage-specific subjects for UPSC/SSC program selections', async () => {
        const res = subjectsHandler(get('/subjects?program=UPSC_CSE&stage=PRELIMS'));
        expect(res.status).toBe(200);
        const body = (await res.json()) as {
            subjects: Array<{ key: string; examTrack: string; examProgram: string; examStage: string; chapters: unknown[] }>;
        };
        expect(body.subjects.map((subject) => subject.key)).toEqual([
            'UPSC-CSE-GS1',
            'UPSC-CSE-CSAT',
        ]);
        expect(body.subjects.every((subject) => subject.examTrack === 'UPSC')).toBe(true);
        expect(body.subjects.every((subject) => subject.examProgram === 'UPSC_CSE')).toBe(true);
        expect(body.subjects.every((subject) => subject.examStage === 'PRELIMS')).toBe(true);
        expect(body.subjects.every((subject) => subject.chapters.length > 0)).toBe(true);
    });

    it('rejects a missing or invalid stage for a modern program lookup', () => {
        expect(subjectsHandler(get('/subjects?program=SSC_CGL')).status).toBe(422);
        expect(subjectsHandler(get('/subjects?program=SSC_CGL&stage=PRELIMS')).status).toBe(422);
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

    it('returns flattened stage-specific chapters for SSC CGL Tier 1', async () => {
        const res = chaptersHandler(get('/chapters?program=SSC_CGL&stage=TIER_1'));
        expect(res.status).toBe(200);
        const body = (await res.json()) as {
            chapters: Array<{ subjectKey: string; subjectName: string; examProgram: string; examStage: string }>;
        };
        expect(body.chapters.length).toBeGreaterThan(0);
        expect(body.chapters.every((chapter) => chapter.examProgram === 'SSC_CGL')).toBe(true);
        expect(body.chapters.every((chapter) => chapter.examStage === 'TIER_1')).toBe(true);
        expect(body.chapters.every((chapter) => chapter.subjectKey && chapter.subjectName)).toBe(true);
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

describe('GET /reference/exam-programs', () => {
    it('returns both first-launch programs', async () => {
        const res = examProgramsHandler(get('/exam-programs'));
        expect(res.status).toBe(200);
        const body = (await res.json()) as { programs: Array<{ key: string; family: string }> };
        expect(body.programs.map((program) => program.key)).toEqual(['UPSC_CSE', 'SSC_CGL']);
        expect(body.programs.map((program) => program.family)).toEqual(['UPSC', 'SSC']);
    });

    it('filters programs by family and supports a single program', async () => {
        const familyResponse = examProgramsHandler(get('/exam-programs?family=UPSC'));
        expect((await familyResponse.json()).programs).toHaveLength(1);

        const programResponse = examProgramsHandler(get('/exam-programs?program=SSC_CGL'));
        const programBody = (await programResponse.json()) as { programs: Array<{ key: string }> };
        expect(programBody.programs[0].key).toBe('SSC_CGL');
    });

    it('rejects invalid or contradictory filters', async () => {
        expect(examProgramsHandler(get('/exam-programs?family=JEE')).status).toBe(422);
        expect(examProgramsHandler(get('/exam-programs?program=JEE')).status).toBe(422);
        expect(examProgramsHandler(get('/exam-programs?family=UPSC&program=SSC_CGL')).status).toBe(422);
    });

    it('parses optional filters without accepting arbitrary values', () => {
        expect(parseExamFamilyParam(new URL(`${BASE}/exam-programs`))).toEqual({ ok: true });
        expect(parseExamFamilyParam(new URL(`${BASE}/exam-programs?family=UPSC`))).toEqual({
            ok: true,
            family: 'UPSC',
        });
        expect(parseExamProgramParam(new URL(`${BASE}/exam-programs?program=SSC_CGL`))).toEqual({
            ok: true,
            program: 'SSC_CGL',
        });
    });
});
