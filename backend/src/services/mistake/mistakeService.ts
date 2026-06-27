/**
 * Mistake Journal service (task 14.1; design "Mistake Journal Service" and "Mistake Journal
 * Flagging"; Req 18.1–18.7).
 *
 * Implements the three endpoints from the design table:
 *
 *   POST /api/mistakes
 *     body: { sourceType: "PYQ"|"TIMED", attemptId, questionId, category, note?, explicitFlag? }
 *     -> 201 { entry }  (created) / 200 { entry } (updated existing — upsert, Req 18.4)
 *     -> 422 VALIDATION_ERROR  (missing/invalid category — Req 18.2; or flagging a
 *                               correctly-answered, unflagged question — Req 18.3; or the
 *                               question is not part of the referenced attempt)
 *     -> 404 NOT_FOUND  (attempt or question missing / not owned by the user)
 *
 *   GET /api/mistakes?subjectId=&category=
 *     -> 200 { entries[] }  filtered by subject and/or category when provided (Req 18.5/18.6),
 *                           otherwise all of the user's entries; always user-scoped (Req 18.7)
 *
 *   DELETE /api/mistakes/:id
 *     -> 204  (per-user ownership; 404 missing, 403 not owned)
 *
 * Server-side answer resolution (Req 18.1): the correct answer and subject are read from the
 * stored `PYQ` row, and the user's submitted answer is read from the referenced attempt's
 * `perQuestion` record — never trusted from the client. The flaggable decision (Req 18.3)
 * and the validation/filter logic are kept as pure, testable functions in sibling modules
 * ({@link ./flagDecision}, {@link ./mistakeValidation}, {@link ./filter}); this module only
 * orchestrates I/O and per-user scoping.
 *
 * The route files wrap these handlers with `withAuth`, so unauthenticated requests are
 * rejected with 401 before any handler runs.
 */
import type { AuthContext } from '@/lib/auth';
import { assertOwnership } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { ErrorCode, errorResponse } from '@/lib/errors';

import {
    decideFlaggable,
    findPerQuestion,
    readPerQuestion,
    resolveSubmittedAnswer,
} from './flagDecision';
import { MISTAKE_LIST_ORDER_BY, buildMistakeWhere } from './filter';
import type { ValidatedMistakeFlag } from './mistakeValidation';
import { validateCategoryFilter, validateMistakeFlagInput } from './mistakeValidation';

/** Safely parse a JSON request body, returning `undefined` when absent/invalid. */
async function readJsonBody(request: Request): Promise<unknown> {
    try {
        return await request.json();
    } catch {
        return undefined;
    }
}

/**
 * Load the referenced attempt (owned by the user) and return its `perQuestion` JSON, or
 * `null` when the attempt does not exist or belongs to another user. The lookup table is
 * chosen by `sourceType` (`PYQ` -> `PYQAttempt`, `TIMED` -> `TimedPaperAttempt`). Returning
 * `null` uniformly for missing/other-user avoids leaking the existence of others' attempts.
 */
async function loadAttemptPerQuestion(
    sourceType: ValidatedMistakeFlag['sourceType'],
    attemptId: string,
    userId: string,
): Promise<unknown | null> {
    if (sourceType === 'PYQ') {
        const attempt = await prisma.pYQAttempt.findUnique({
            where: { id: attemptId },
            select: { userId: true, perQuestion: true },
        });
        if (!attempt || attempt.userId !== userId) {
            return null;
        }
        return attempt.perQuestion;
    }

    const attempt = await prisma.timedPaperAttempt.findUnique({
        where: { id: attemptId },
        select: { userId: true, perQuestion: true },
    });
    if (!attempt || attempt.userId !== userId) {
        return null;
    }
    return attempt.perQuestion;
}

/**
 * Handle `POST /api/mistakes`. Validates the body, loads the referenced attempt (user-scoped),
 * enforces the flaggable rule (Req 18.3), resolves the correct answer/subject and submitted
 * answer server-side, and upserts on `(userId, questionId)` so a re-flag updates rather than
 * duplicates (Req 18.4). Returns 201 on create, 200 on update.
 */
export async function flagMistakeHandler(request: Request, auth: AuthContext): Promise<Response> {
    const body = await readJsonBody(request);
    if (typeof body !== 'object' || body === null) {
        return errorResponse(
            422,
            ErrorCode.VALIDATION_ERROR,
            'Request body must be a JSON object.',
        );
    }

    const validation = validateMistakeFlagInput(body as Record<string, unknown>);
    if (!validation.ok) {
        return errorResponse(
            422,
            ErrorCode.VALIDATION_ERROR,
            validation.message,
            validation.details,
        );
    }

    const { sourceType, attemptId, questionId, category, note, explicitFlag } = validation.value;

    // Load the referenced attempt's per-question outcomes, scoped to the user.
    const perQuestionJson = await loadAttemptPerQuestion(sourceType, attemptId, auth.user.id);
    if (perQuestionJson === null) {
        return errorResponse(404, ErrorCode.NOT_FOUND, 'Referenced attempt not found.');
    }

    const perQuestion = readPerQuestion(perQuestionJson);
    const record = findPerQuestion(perQuestion, questionId);

    // Decide whether this question may be flagged (Req 18.3).
    const decision = decideFlaggable(record, explicitFlag);
    if (!decision.allowed) {
        const message =
            decision.reason === 'NOT_IN_ATTEMPT'
                ? 'The question is not part of the referenced attempt.'
                : 'Cannot flag a question that was answered correctly and not explicitly flagged.';
        return errorResponse(422, ErrorCode.VALIDATION_ERROR, message, { field: 'questionId' });
    }

    // Resolve the correct answer and subject SERVER-SIDE from the stored question row.
    const question = await prisma.pYQ.findUnique({
        where: { id: questionId },
        select: { subjectId: true, correctOption: true },
    });
    if (!question) {
        return errorResponse(404, ErrorCode.NOT_FOUND, 'Question not found.');
    }

    // Resolve the user's submitted (wrong) answer SERVER-SIDE from the attempt record.
    // `record` is non-null here because the decision was allowed.
    const submittedAnswer = record ? resolveSubmittedAnswer(record) : null;

    // Upsert on (userId, questionId): update an existing entry, else create — never
    // duplicate (Req 18.4). createdAt === updatedAt iff the row was just created.
    const entry = await prisma.mistakeJournalEntry.upsert({
        where: { userId_questionId: { userId: auth.user.id, questionId } },
        update: {
            subjectId: question.subjectId,
            sourceType,
            submittedAnswer,
            correctAnswer: question.correctOption,
            category,
            note,
        },
        create: {
            userId: auth.user.id,
            questionId,
            subjectId: question.subjectId,
            sourceType,
            submittedAnswer,
            correctAnswer: question.correctOption,
            category,
            note,
        },
    });

    const created = entry.createdAt.getTime() === entry.updatedAt.getTime();
    return Response.json({ entry }, { status: created ? 201 : 200 });
}

/**
 * Handle `GET /api/mistakes?subjectId=&category=`. Returns the authenticated user's Mistake
 * Journal entries, filtered by subject and/or category when those query params are provided
 * (Req 18.5/18.6) and all entries otherwise. Always user-scoped (Req 18.7).
 */
export async function listMistakesHandler(
    request: Request,
    auth: AuthContext,
): Promise<Response> {
    const url = new URL(request.url);
    const subjectId = url.searchParams.get('subjectId');

    const categoryResult = validateCategoryFilter(url.searchParams.get('category'));
    if (!categoryResult.ok) {
        return errorResponse(422, ErrorCode.VALIDATION_ERROR, categoryResult.message, {
            field: 'category',
        });
    }

    const where = buildMistakeWhere(auth.user.id, {
        subjectId,
        category: categoryResult.value,
    });

    const entries = await prisma.mistakeJournalEntry.findMany({
        where,
        orderBy: MISTAKE_LIST_ORDER_BY,
    });

    return Response.json({ entries });
}

/** Framework route context for the dynamic `/:id` segment. */
export interface MistakeRouteContext {
    params: { id: string };
}

/**
 * Handle `DELETE /api/mistakes/:id`. Removes a single Mistake Journal entry after enforcing
 * per-user ownership: a missing entry returns 404; an entry owned by another user yields 403
 * via {@link assertOwnership} (mapped by `withAuth`). On success returns `204 No Content`.
 */
export async function deleteMistakeHandler(
    _request: Request,
    auth: AuthContext,
    routeContext: MistakeRouteContext,
): Promise<Response> {
    const { id } = routeContext.params;
    if (typeof id !== 'string' || id.trim() === '') {
        return errorResponse(422, ErrorCode.VALIDATION_ERROR, 'An entry id is required.', {
            field: 'id',
        });
    }

    const entry = await prisma.mistakeJournalEntry.findUnique({
        where: { id },
        select: { id: true, userId: true },
    });

    if (!entry) {
        return errorResponse(404, ErrorCode.NOT_FOUND, 'Mistake journal entry not found.');
    }

    // Cross-user delete attempt -> 403 FORBIDDEN (thrown, mapped by withAuth).
    assertOwnership(entry.userId, auth.user.id);

    await prisma.mistakeJournalEntry.delete({ where: { id } });

    return new Response(null, { status: 204 });
}
