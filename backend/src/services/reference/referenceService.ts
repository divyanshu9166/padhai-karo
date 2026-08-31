/**
 * Reference Data Service handlers (task 3.2).
 *
 * Serves the system-seeded, track-keyed reference catalog (subjects, chapters, and
 * per-track/year target exam dates) over the read endpoints described in the design
 * "Reference Data Service" table:
 *
 *   GET /api/reference/subjects?track=JEE|NEET     -> 200 { subjects[] }
 *   GET /api/reference/chapters?track=JEE|NEET     -> 200 { chapters[] }
 *   GET /api/reference/exam-date?track=...&year=.. -> 200 { targetExamDate } | 404
 *
 * These are read-only lookups served entirely from the in-memory catalog
 * (`src/lib/reference`), so no database access is required.
 *
 * The handlers here are deliberately framework-thin and free of any auth concern.
 * Per the design "Authentication Posture", reference reads are authenticated like other
 * endpoints, but the session-validation guard is introduced in task 2.3 and is not yet
 * available. The App Router route files delegate to these pure-ish handlers so the guard
 * can later wrap them (e.g. `export const GET = withAuth(subjectsHandler)`) without any
 * change to the handler logic below.
 */
import {
    EXAM_TRACKS,
    getChapters,
    getExamDate,
    getSubjects,
} from '@/lib/reference';
import {
    EXAM_PROGRAM_KEYS,
    getExamProgram,
    getExamProgramsByFamily,
    getSubjectsForStage,
} from '@/lib/exams';
import type { ExamFamily, ExamProgramKey, ExamStage } from '@/lib/exams';
import type { ExamTrack } from '@/lib/reference';
import { ErrorCode, errorResponse } from '@/lib/errors/errorEnvelope';

/**
 * Result of parsing the `track` query param: either a valid `ExamTrack` or a ready-to-
 * return 422 validation `Response`. Callers narrow on the discriminant.
 */
type TrackParse = { ok: true; track: ExamTrack } | { ok: false; response: Response };

/**
 * Validate the `track` query param against the allowed `ExamTrack` values. A missing or
 * unrecognized track yields a 422 VALIDATION_ERROR carrying the list of allowed values.
 */
export function parseTrackParam(url: URL): TrackParse {
    const raw = url.searchParams.get('track');
    if (raw === null || raw.trim() === '') {
        return {
            ok: false,
            response: errorResponse(
                422,
                ErrorCode.VALIDATION_ERROR,
                'Query parameter "track" is required.',
                { param: 'track', allowed: EXAM_TRACKS },
            ),
        };
    }
    if (!(EXAM_TRACKS as string[]).includes(raw)) {
        return {
            ok: false,
            response: errorResponse(
                422,
                ErrorCode.VALIDATION_ERROR,
                `Query parameter "track" must be one of: ${EXAM_TRACKS.join(', ')}.`,
                { param: 'track', value: raw, allowed: EXAM_TRACKS },
            ),
        };
    }
    return { ok: true, track: raw as ExamTrack };
}

/**
 * Parse the `year` query param as a valid integer. Rejects missing, non-numeric, and
 * non-integer (e.g. "2026.5") values with a 422 VALIDATION_ERROR.
 */
type YearParse = { ok: true; year: number } | { ok: false; response: Response };

export function parseYearParam(url: URL): YearParse {
    const raw = url.searchParams.get('year');
    if (raw === null || raw.trim() === '') {
        return {
            ok: false,
            response: errorResponse(
                422,
                ErrorCode.VALIDATION_ERROR,
                'Query parameter "year" is required.',
                { param: 'year' },
            ),
        };
    }
    // Accept only a canonical integer string (optionally signed). This rejects
    // "2026.5", "2026abc", "  ", and "0x7e0" which Number() would otherwise coerce.
    if (!/^[+-]?\d+$/.test(raw.trim())) {
        return {
            ok: false,
            response: errorResponse(
                422,
                ErrorCode.VALIDATION_ERROR,
                'Query parameter "year" must be a valid integer.',
                { param: 'year', value: raw },
            ),
        };
    }
    return { ok: true, year: Number.parseInt(raw.trim(), 10) };
}

type ProgramStageParse =
    | { ok: true; program?: ExamProgramKey; stage?: ExamStage }
    | { ok: false; response: Response };

/** Parse the optional modern `program` + `stage` reference filters. */
function parseProgramStageParam(url: URL): ProgramStageParse {
    const parsedProgram = parseExamProgramParam(url);
    if (!parsedProgram.ok) return parsedProgram;

    const rawStage = url.searchParams.get('stage');
    if (parsedProgram.program === undefined && (rawStage === null || rawStage.trim() === '')) {
        return { ok: true };
    }
    if (parsedProgram.program === undefined) {
        return {
            ok: false,
            response: errorResponse(
                422,
                ErrorCode.VALIDATION_ERROR,
                'Query parameter "program" is required when "stage" is provided.',
                { param: 'program' },
            ),
        };
    }

    const program = getExamProgram(parsedProgram.program);
    if (rawStage === null || rawStage.trim() === '') {
        return {
            ok: false,
            response: errorResponse(
                422,
                ErrorCode.VALIDATION_ERROR,
                'Query parameter "stage" is required for a program reference lookup.',
                { param: 'stage', allowed: program.stages },
            ),
        };
    }
    if (!(program.stages as readonly string[]).includes(rawStage)) {
        return {
            ok: false,
            response: errorResponse(
                422,
                ErrorCode.VALIDATION_ERROR,
                `Query parameter "stage" must be one of: ${program.stages.join(', ')} for ${program.shortName}.`,
                { param: 'stage', value: rawStage, allowed: program.stages },
            ),
        };
    }
    return { ok: true, program: parsedProgram.program, stage: rawStage as ExamStage };
}

function modernSubjects(program: ExamProgramKey, stage: ExamStage) {
    const family = getExamProgram(program).family;
    return getSubjectsForStage(program, stage).map((subject) => ({
        key: subject.key,
        name: subject.name,
        examTrack: family,
        examProgram: program,
        examStage: stage,
        chapters: subject.units.map((unit, index) => ({
            referenceKey: `${subject.key}-${index + 1}`,
            name: unit,
            weightage: subject.planningPriority,
            estimatedStudyHours: 2,
            taskDifficulty: 'HARD' as const,
        })),
    }));
}

/**
 * GET /api/reference/subjects?track=JEE|NEET
 *
 * Returns the subjects (each with their canonical chapter list) for the track.
 */
export function subjectsHandler(request: Request): Response {
    const url = new URL(request.url);
    const parsedProgramStage = parseProgramStageParam(url);
    if (!parsedProgramStage.ok) {
        return parsedProgramStage.response;
    }
    if (parsedProgramStage.program && parsedProgramStage.stage) {
        return Response.json({
            subjects: modernSubjects(parsedProgramStage.program, parsedProgramStage.stage),
        });
    }
    const parsed = parseTrackParam(url);
    if (!parsed.ok) {
        return parsed.response;
    }
    return Response.json({ subjects: getSubjects(parsed.track) });
}

/**
 * GET /api/reference/chapters?track=JEE|NEET
 *
 * Returns every chapter for the track, flattened and annotated with its owning
 * subject key/name (via the catalog's `getChapters` accessor).
 */
export function chaptersHandler(request: Request): Response {
    const url = new URL(request.url);
    const parsedProgramStage = parseProgramStageParam(url);
    if (!parsedProgramStage.ok) {
        return parsedProgramStage.response;
    }
    if (parsedProgramStage.program && parsedProgramStage.stage) {
        const chapters = modernSubjects(parsedProgramStage.program, parsedProgramStage.stage).flatMap(
            (subject) =>
                subject.chapters.map((chapter) => ({
                    ...chapter,
                    subjectKey: subject.key,
                    subjectName: subject.name,
                    examTrack: subject.examTrack,
                    examProgram: subject.examProgram,
                    examStage: subject.examStage,
                })),
        );
        return Response.json({ chapters });
    }
    const parsed = parseTrackParam(url);
    if (!parsed.ok) {
        return parsed.response;
    }
    return Response.json({ chapters: getChapters(parsed.track) });
}

/**
 * GET /api/reference/exam-date?track=JEE|NEET&year=YYYY
 *
 * Returns the Target_Exam_Date for the track/year as an ISO date string.
 *
 * Absent-date contract (documented decision per task 3.2): when the catalog has no
 * representative date for the requested track/year, this returns 404 NOT_FOUND rather
 * than a 200 with a null body. The lookup is keyed by track+year, so an unknown year is
 * genuinely "not found"; a 404 lets clients distinguish "no data" from a real null.
 */
export function examDateHandler(request: Request): Response {
    const url = new URL(request.url);
    const parsedTrack = parseTrackParam(url);
    if (!parsedTrack.ok) {
        return parsedTrack.response;
    }
    const parsedYear = parseYearParam(url);
    if (!parsedYear.ok) {
        return parsedYear.response;
    }

    const examDate = getExamDate(parsedTrack.track, parsedYear.year);
    if (examDate === undefined) {
        return errorResponse(
            404,
            ErrorCode.NOT_FOUND,
            `No target exam date found for track "${parsedTrack.track}" and year ${parsedYear.year}.`,
            { track: parsedTrack.track, year: parsedYear.year },
        );
    }

    return Response.json({ targetExamDate: examDate.toISOString() });
}

type FamilyParse = { ok: true; family?: ExamFamily } | { ok: false; response: Response };

/**
 * Parse the optional `family` filter for the new UPSC/SSC program registry.
 * Omitting it returns both first-launch programs.
 */
export function parseExamFamilyParam(url: URL): FamilyParse {
    const raw = url.searchParams.get('family');
    if (raw === null || raw.trim() === '') {
        return { ok: true };
    }
    if (raw !== 'UPSC' && raw !== 'SSC') {
        return {
            ok: false,
            response: errorResponse(
                422,
                ErrorCode.VALIDATION_ERROR,
                'Query parameter "family" must be one of: UPSC, SSC.',
                { param: 'family', value: raw, allowed: ['UPSC', 'SSC'] },
            ),
        };
    }
    return { ok: true, family: raw };
}

/**
 * Parse a program key when a single program is requested. This deliberately uses the
 * catalog's allow-list instead of accepting arbitrary strings from the client.
 */
export function parseExamProgramParam(url: URL):
    | { ok: true; program?: ExamProgramKey }
    | { ok: false; response: Response } {
    const raw = url.searchParams.get('program');
    if (raw === null || raw.trim() === '') {
        return { ok: true };
    }
    if (!(EXAM_PROGRAM_KEYS as readonly string[]).includes(raw)) {
        return {
            ok: false,
            response: errorResponse(
                422,
                ErrorCode.VALIDATION_ERROR,
                `Query parameter "program" must be one of: ${EXAM_PROGRAM_KEYS.join(', ')}.`,
                { param: 'program', value: raw, allowed: EXAM_PROGRAM_KEYS },
            ),
        };
    }
    return { ok: true, program: raw as ExamProgramKey };
}

/**
 * GET /api/reference/exam-programs[?family=UPSC|SSC|&program=UPSC_CSE|SSC_CGL]
 *
 * This additive endpoint exposes the program/stage/paper/subject vocabulary needed by
 * the UPSC/SSC onboarding flow. The legacy JEE/NEET reference endpoints remain intact
 * until their callers are migrated to this registry.
 */
export function examProgramsHandler(request: Request): Response {
    const url = new URL(request.url);
    const parsedFamily = parseExamFamilyParam(url);
    if (!parsedFamily.ok) {
        return parsedFamily.response;
    }
    const parsedProgram = parseExamProgramParam(url);
    if (!parsedProgram.ok) {
        return parsedProgram.response;
    }

    if (parsedProgram.program) {
        const program = getExamProgram(parsedProgram.program);
        if (parsedFamily.family && program.family !== parsedFamily.family) {
            return errorResponse(
                422,
                ErrorCode.VALIDATION_ERROR,
                `Program "${parsedProgram.program}" does not belong to family "${parsedFamily.family}".`,
                { param: 'program', family: parsedFamily.family },
            );
        }
        return Response.json({ programs: [program] });
    }

    const programs = parsedFamily.family
        ? getExamProgramsByFamily(parsedFamily.family)
        : EXAM_PROGRAM_KEYS.map((key) => getExamProgram(key));
    return Response.json({ programs });
}
