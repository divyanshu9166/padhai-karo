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

/**
 * GET /api/reference/subjects?track=JEE|NEET
 *
 * Returns the subjects (each with their canonical chapter list) for the track.
 */
export function subjectsHandler(request: Request): Response {
    const url = new URL(request.url);
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
