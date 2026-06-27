/**
 * Pure filter-criteria building for `GET /api/mistakes?subjectId=&category=` (task 14.1;
 * design "Mistake Journal Service"; Req 18.5, 18.6, 18.7).
 *
 * The Mistake Journal is always scoped to the authenticated user (Req 18.7); `subjectId` and
 * `category` are optional, additive filters applied only when provided (Req 18.5/18.6). This
 * module produces the Prisma `where` clause as a plain object so it is unit-testable without
 * a live database; the handler in {@link ./mistakeService} passes it straight to
 * `prisma.mistakeJournalEntry.findMany`.
 */
import type { MistakeCategoryValue } from './mistakeValidation';

/** The optional, additive filters parsed from the query string. */
export interface MistakeFilterCriteria {
    /** Restrict to entries whose question belongs to this subject (Req 18.5). */
    subjectId?: string | null;
    /** Restrict to entries with this Mistake_Category (Req 18.6). */
    category?: MistakeCategoryValue | null;
}

/** The Prisma `where` shape for a Mistake Journal query. */
export interface MistakeWhere {
    userId: string;
    subjectId?: string;
    category?: MistakeCategoryValue;
}

/**
 * Stable ordering for the journal listing: newest first, with `id` as a deterministic
 * tiebreaker so results are reproducible.
 */
export const MISTAKE_LIST_ORDER_BY = [{ createdAt: 'desc' as const }, { id: 'asc' as const }];

/**
 * Build the Prisma `where` clause for a Mistake Journal query (Req 18.5, 18.6, 18.7).
 *
 * Always pins `userId` for per-user isolation. A non-blank `subjectId` and/or a `category`
 * are added only when provided; absent or blank filters are omitted so the query returns all
 * of the user's entries.
 */
export function buildMistakeWhere(
    userId: string,
    criteria: MistakeFilterCriteria = {},
): MistakeWhere {
    const where: MistakeWhere = { userId };

    if (typeof criteria.subjectId === 'string' && criteria.subjectId.trim() !== '') {
        where.subjectId = criteria.subjectId.trim();
    }

    if (criteria.category != null) {
        where.category = criteria.category;
    }

    return where;
}
