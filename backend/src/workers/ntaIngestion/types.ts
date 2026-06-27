/**
 * Types for the `nta-ingestion` worker (Req 20).
 *
 * The worker fetches official NTA announcements (JEE Main, JEE Advanced, NEET),
 * validates and sanitizes them, de-duplicates, stores them, and propagates exam-date
 * changes to affected users (Req 20.1–20.4, 20.6).
 *
 * The source fetcher is abstracted behind {@link NtaSource} so the concrete RSS/scraper
 * adapter (a thin, network-bound seam) can be swapped for a fixture/mock in tests. All
 * other logic in this module is pure and exercised directly by unit tests.
 *
 * The string unions below mirror domain values without importing the Prisma client, so
 * the pure helpers stay free of database/runtime dependencies.
 */
import type { ExamTrack } from '@/lib/reference';

/**
 * The scope an NTA announcement applies to. Stored verbatim on
 * `NTAAnnouncement.examScope`; mapped to an {@link ExamTrack} for feed filtering and
 * exam-date propagation via {@link examScopeToTrack}.
 */
export const EXAM_SCOPES = ['JEE_MAIN', 'JEE_ADVANCED', 'NEET'] as const;

export type ExamScope = (typeof EXAM_SCOPES)[number];

/**
 * A raw, UNTRUSTED item as returned by an {@link NtaSource}. Every field is `unknown`
 * because the upstream source (scraper/RSS) is outside our control: nothing may be
 * assumed about its shape or content until it has passed {@link parseAndValidate}.
 */
export interface RawNtaItem {
    examScope?: unknown;
    title?: unknown;
    body?: unknown;
    publishedAt?: unknown;
    affectsExamDate?: unknown;
    newExamDate?: unknown;
    [key: string]: unknown;
}

/**
 * A validated, sanitized announcement ready to be stored. `title`/`body` are sanitized
 * plain text (Req 20.2); `dedupeHash` is the content fingerprint used for
 * de-duplication (Req 20.4).
 */
export interface SanitizedAnnouncement {
    examScope: ExamScope;
    title: string;
    body: string;
    publishedAt: Date;
    affectsExamDate: boolean;
    newExamDate: Date | null;
    dedupeHash: string;
}

/** Discriminated result of parsing+validating a single raw item. */
export type ParseResult =
    | { ok: true; value: SanitizedAnnouncement }
    | { ok: false; reason: string };

/**
 * The source-fetcher seam. The concrete implementation talks to official NTA
 * scraper/RSS endpoints; tests inject a fixture implementation so no live network call
 * is ever made.
 */
export interface NtaSource {
    /** Fetch the current batch of raw, untrusted announcement items. */
    fetchAnnouncements(): Promise<RawNtaItem[]>;
}

/**
 * Maps an {@link ExamScope} to the {@link ExamTrack} whose users it affects. Both JEE
 * Main and JEE Advanced map to the `JEE` track; NEET maps to `NEET`. Used for feed
 * filtering (Req 20.5) and exam-date propagation (Req 20.6).
 */
export function examScopeToTrack(scope: ExamScope): ExamTrack {
    return scope === 'NEET' ? 'NEET' : 'JEE';
}
