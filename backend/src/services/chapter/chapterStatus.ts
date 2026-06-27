/**
 * Chapter status lifecycle: pure, reusable transition logic (task 5.1; design "Chapter
 * Status Lifecycle"; Req 12.1, 12.2).
 *
 * Chapter_Status is an ORDERED lifecycle:
 *
 *     NOT_STARTED → IN_PROGRESS → DONE → REVISED
 *
 * The design states a transition is accepted "only if it moves forward along this order
 * (adjacent or further-forward steps); illegal/backward transitions are rejected". This
 * module captures that rule as small pure functions so it is:
 *   - unit-testable without a database or framework, and
 *   - reusable by the PATCH /chapters/:id/status handler (task 5.1) and the chapter status
 *     transition ordering property test (Property 26, task 5.5).
 *
 * Exact "forward" semantics implemented here (documented decision for task 5.1):
 *   - A transition is valid IFF the destination status ranks STRICTLY higher than the
 *     source status in {@link CHAPTER_STATUS_ORDER}. This permits both adjacent moves
 *     (e.g. NOT_STARTED → IN_PROGRESS) and forward SKIPS (e.g. NOT_STARTED → DONE,
 *     IN_PROGRESS → REVISED).
 *   - Any BACKWARD move (e.g. DONE → IN_PROGRESS) is rejected.
 *   - A NO-OP / same-state "transition" (e.g. DONE → DONE) is rejected: it does not move
 *     forward along the order, so it is treated as an illegal transition rather than an
 *     accepted no-op. Callers that want idempotent no-ops should special-case equality
 *     before calling; the lifecycle rule itself is strictly monotonic.
 *   - An unknown source or destination value is never a valid transition.
 */
import type { ChapterStatus } from '@prisma/client';

/**
 * The chapter lifecycle in ascending order. A status's array index is its "rank"; a valid
 * transition strictly increases rank. Kept in sync with the Prisma `ChapterStatus` enum.
 */
export const CHAPTER_STATUS_ORDER: readonly ChapterStatus[] = [
    'NOT_STARTED',
    'IN_PROGRESS',
    'DONE',
    'REVISED',
];

/**
 * Type guard: is `value` one of the known {@link ChapterStatus} lifecycle values? Lets the
 * handler reject an unrecognized `status` in the request body without a database round-trip
 * (Req 12.1).
 */
export function isChapterStatus(value: unknown): value is ChapterStatus {
    return typeof value === 'string' && (CHAPTER_STATUS_ORDER as string[]).includes(value);
}

/**
 * The ordinal rank of a status within {@link CHAPTER_STATUS_ORDER}, or `-1` if the value is
 * not a known status. Useful for comparing two statuses' positions in the lifecycle.
 */
export function chapterStatusRank(status: ChapterStatus): number {
    return CHAPTER_STATUS_ORDER.indexOf(status);
}

/**
 * Is moving `from` → `to` a valid forward transition along the chapter lifecycle?
 *
 * Returns `true` IFF both values are known statuses and `to` ranks strictly higher than
 * `from` (Req 12.2). Adjacent and further-forward steps are allowed; backward moves and
 * same-state no-ops return `false`. Pure: no I/O, total over all inputs.
 */
export function isValidStatusTransition(from: ChapterStatus, to: ChapterStatus): boolean {
    if (!isChapterStatus(from) || !isChapterStatus(to)) {
        return false;
    }
    return chapterStatusRank(to) > chapterStatusRank(from);
}
