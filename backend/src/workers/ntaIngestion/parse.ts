/**
 * Pure parse + validation of a raw, untrusted NTA item (Req 20.2, 20.3, 20.4).
 *
 * `parseAndValidate` defensively coerces an arbitrary {@link RawNtaItem} into a stored
 * {@link SanitizedAnnouncement}, or reports WHY the item is malformed so the worker can
 * SKIP it without failing the rest of the batch (Req 20.3). Sanitization (Req 20.2) and
 * the dedupe-hash (Req 20.4) are applied here so the worker only ever sees clean,
 * fingerprinted records.
 *
 * Validation rules (an item is malformed if any fails):
 *  - `examScope` is one of the known scopes (JEE_MAIN | JEE_ADVANCED | NEET);
 *  - `title` is a string that is non-empty AFTER sanitization;
 *  - `body` is a string that is non-empty AFTER sanitization;
 *  - `publishedAt` parses to a valid date;
 *  - if `affectsExamDate` is truthy, `newExamDate` parses to a valid date (an item that
 *    claims to move the exam date but supplies no valid date is malformed).
 *
 * This module is pure: no database, network, or framework dependencies.
 */
import { computeDedupeHash } from './dedupe';
import { sanitizeText } from './sanitize';
import { EXAM_SCOPES, type ExamScope, type ParseResult, type RawNtaItem } from './types';

/** Coerce an unknown value to a valid `Date`, or `null` when it cannot be parsed. */
function coerceDate(value: unknown): Date | null {
    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? null : value;
    }
    if (typeof value === 'string' || typeof value === 'number') {
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? null : date;
    }
    return null;
}

/** Type guard: is `value` a known {@link ExamScope}? */
function isExamScope(value: unknown): value is ExamScope {
    return typeof value === 'string' && (EXAM_SCOPES as readonly string[]).includes(value);
}

/**
 * Parse, validate, and sanitize a single raw item.
 *
 * @returns `{ ok: true, value }` with the sanitized, fingerprinted announcement, or
 *          `{ ok: false, reason }` describing why the item is malformed/unparseable.
 */
export function parseAndValidate(raw: RawNtaItem): ParseResult {
    if (raw === null || typeof raw !== 'object') {
        return { ok: false, reason: 'item is not an object' };
    }

    if (!isExamScope(raw.examScope)) {
        return { ok: false, reason: 'examScope is missing or not a recognized scope' };
    }
    const examScope = raw.examScope;

    if (typeof raw.title !== 'string') {
        return { ok: false, reason: 'title is missing or not a string' };
    }
    if (typeof raw.body !== 'string') {
        return { ok: false, reason: 'body is missing or not a string' };
    }

    const title = sanitizeText(raw.title);
    const body = sanitizeText(raw.body);
    if (title.length === 0) {
        return { ok: false, reason: 'title is empty after sanitization' };
    }
    if (body.length === 0) {
        return { ok: false, reason: 'body is empty after sanitization' };
    }

    const publishedAt = coerceDate(raw.publishedAt);
    if (publishedAt === null) {
        return { ok: false, reason: 'publishedAt is missing or not a valid date' };
    }

    const affectsExamDate = raw.affectsExamDate === true;
    let newExamDate: Date | null = null;
    if (affectsExamDate) {
        newExamDate = coerceDate(raw.newExamDate);
        if (newExamDate === null) {
            return {
                ok: false,
                reason: 'affectsExamDate is set but newExamDate is missing or invalid',
            };
        }
    }

    const dedupeHash = computeDedupeHash({ examScope, title, body, publishedAt });

    return {
        ok: true,
        value: { examScope, title, body, publishedAt, affectsExamDate, newExamDate, dedupeHash },
    };
}
