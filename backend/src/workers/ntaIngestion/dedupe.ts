/**
 * Pure de-duplication fingerprint for NTA announcements (Req 20.4).
 *
 * `computeDedupeHash` produces a stable SHA-256 hex digest over an announcement's
 * content-identity fields (scope, sanitized title, sanitized body, publication
 * instant). Two announcements that carry the same content collapse to the same hash;
 * any difference in those fields yields a different hash. The hash is stored on the
 * unique `NTAAnnouncement.dedupeHash` column so re-ingesting the same item never
 * creates a second copy.
 *
 * Identity is computed over SANITIZED content, so two raw items that differ only in
 * markup/whitespace (and therefore mean the same thing) de-duplicate correctly.
 */
import { createHash } from 'node:crypto';

/** The fields that define an announcement's content identity. */
export interface DedupeInput {
    /** Exam scope (e.g. JEE_MAIN, NEET). */
    examScope: string;
    /** Sanitized title. */
    title: string;
    /** Sanitized body. */
    body: string;
    /** Publication instant. */
    publishedAt: Date;
}

/**
 * Compute the de-duplication hash for an announcement.
 *
 * The fields are serialized as a JSON array so the boundaries between fields are
 * unambiguous (no delimiter-injection: a title ending in the delimiter cannot be
 * confused with the start of the body). The publication instant is normalized to its
 * ISO-8601 string so equal instants hash identically regardless of `Date` identity.
 */
export function computeDedupeHash(input: DedupeInput): string {
    const canonical = JSON.stringify([
        input.examScope,
        input.title,
        input.body,
        input.publishedAt.toISOString(),
    ]);
    return createHash('sha256').update(canonical, 'utf8').digest('hex');
}
