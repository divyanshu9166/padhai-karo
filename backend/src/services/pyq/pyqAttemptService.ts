/**
 * PYQ attempt submission and persistence service (task 11.3, design "PYQ Practice +
 * Scoring Service").
 *
 * Implements the two attempt endpoints from the design table:
 *
 *   POST /api/pyq-attempts
 *     body: { paperOrSetRef, answers: [{ questionId, selectedOption? }], clientId? }
 *     -> 201 { attemptId, totalScore, perQuestion[] }                 (Req 6.2–6.5)
 *     -> 422 VALIDATION_ERROR (bad body)
 *     -> 409 CONFLICT (a prior attempt used the same clientId)        (Req 21 seam)
 *
 *   GET /api/pyq-attempts/:id
 *     -> 200 { attempt }                                              (Req 6.5)
 *     -> 404 NOT_FOUND / 403 FORBIDDEN (per-user ownership)
 *
 * Server-side answer key (Req 6.2/6.3/6.4): the correct answer is NEVER taken from the
 * client. The handler loads the referenced PYQ rows by id and builds the answer key from
 * their stored `correctOption`. Scoring is delegated to the shared pure
 * {@link scoreAttempt} function (task 11.1) so PYQ practice and Timed Paper Mode score
 * identically. Unanswered questions are scored incorrect while labeled `UNANSWERED`.
 *
 * Availability (Req 6.6/9.4): submission is available to every Subscription_Tier — the
 * handler performs no tier gating; the only access control is the `withAuth` session guard
 * that wraps the route, and every read/write is scoped to `ctx.user.id`.
 *
 * clientId idempotency (documented decision): this endpoint relies on the
 * `@@unique([userId, clientId])` constraint and, on a duplicate replay, returns
 * `409 CONFLICT` (mirroring the focus-session handler). It deliberately does NOT implement
 * the read-your-prior-result idempotent behaviour; that full offline-sync semantics is
 * task 18.1 (`POST /sync`). Keeping it a simple 409 here avoids duplicating that logic.
 *
 * The answer-key assembly and scoring orchestration are kept as small pure functions
 * ({@link buildAnswerKey}, {@link scorePyqAttempt}) so they are unit-testable without a
 * live database (the question lookup is injected/mocked).
 */
import { Prisma } from '@prisma/client';

import type { AuthContext } from '@/lib/auth';
import { assertOwnership } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { ErrorCode, errorResponse } from '@/lib/errors';
import type { AnswerKeyEntry, PerQuestionResult } from '@/lib/scoring';
import { scoreAttempt } from '@/lib/scoring';

import type { NormalizedAnswer, ValidatedPyqAttempt } from './pyqAttemptValidation';
import { validatePyqAttemptInput } from './pyqAttemptValidation';

/** The minimal PYQ row shape needed to assemble an answer key: its id and correct option. */
export interface PyqAnswerSource {
    id: string;
    correctOption: number;
}

/**
 * Build the official answer key from the loaded PYQ rows (Req 6.2/6.3). The integer
 * `correctOption` (a 0-based option index) is stringified so it shares the string-keyed
 * shape the pure {@link scoreAttempt} compares against; the client's selected option is
 * stringified the same way in {@link scorePyqAttempt}, so equal indices compare equal.
 *
 * The answer key — not the submitted answers — defines the full set of questions that get
 * scored. A submitted answer for a question id that was not loaded is therefore ignored,
 * and a loaded question with no submitted answer is scored `UNANSWERED`.
 */
export function buildAnswerKey(questions: ReadonlyArray<PyqAnswerSource>): AnswerKeyEntry[] {
    return questions.map((question) => ({
        questionId: question.id,
        correctOption: String(question.correctOption),
    }));
}

/** The result of scoring an attempt: per-question outcomes (key order) and the total. */
export interface PyqScoreResult {
    perQuestion: PerQuestionResult[];
    totalScore: number;
}

/**
 * Orchestrate scoring of a validated attempt against the loaded PYQ rows (Req 6.2–6.4).
 * Builds the server-side answer key, stringifies each selected option to match, and
 * delegates to the shared {@link scoreAttempt}. Pure: no I/O, so it is unit-testable by
 * passing in question rows directly.
 */
export function scorePyqAttempt(
    answers: ReadonlyArray<NormalizedAnswer>,
    questions: ReadonlyArray<PyqAnswerSource>,
): PyqScoreResult {
    const answerKey = buildAnswerKey(questions);
    const scoreInput = answers.map((answer) => ({
        questionId: answer.questionId,
        selectedOption: answer.selectedOption === null ? null : String(answer.selectedOption),
    }));
    return scoreAttempt(scoreInput, answerKey);
}

/** Safely parse a JSON request body, returning `undefined` when absent/invalid. */
async function readJsonBody(request: Request): Promise<unknown> {
    try {
        return await request.json();
    } catch {
        return undefined;
    }
}

/** Load the referenced PYQ rows (id + correctOption) for the submitted answers. */
async function loadAnswerSources(
    answers: ReadonlyArray<NormalizedAnswer>,
): Promise<PyqAnswerSource[]> {
    const questionIds = [...new Set(answers.map((answer) => answer.questionId))];
    if (questionIds.length === 0) {
        return [];
    }
    return prisma.pYQ.findMany({
        where: { id: { in: questionIds } },
        select: { id: true, correctOption: true },
    });
}

/**
 * Handle `POST /api/pyq-attempts`. Validates the body, resolves the server-side answer key
 * from the stored PYQ rows, scores via the shared pure function, and persists a
 * `PYQAttempt` scoped to the authenticated user. The route file wraps this with `withAuth`
 * so unauthenticated requests are rejected upstream.
 */
export async function createPyqAttemptHandler(
    request: Request,
    auth: AuthContext,
): Promise<Response> {
    const body = await readJsonBody(request);
    if (typeof body !== 'object' || body === null) {
        return errorResponse(
            422,
            ErrorCode.VALIDATION_ERROR,
            'Request body must be a JSON object.',
        );
    }

    const validation = validatePyqAttemptInput(body as Record<string, unknown>);
    if (!validation.ok) {
        return errorResponse(
            422,
            ErrorCode.VALIDATION_ERROR,
            validation.message,
            validation.details,
        );
    }

    const { paperOrSetRef, answers, clientId }: ValidatedPyqAttempt = validation.value;

    // Resolve the answer key SERVER-SIDE from the stored PYQ rows (never from the client).
    const questions = await loadAnswerSources(answers);
    const { perQuestion, totalScore } = scorePyqAttempt(answers, questions);

    try {
        const attempt = await prisma.pYQAttempt.create({
            data: {
                userId: auth.user.id,
                paperOrSetRef,
                answers: answers as unknown as Prisma.InputJsonValue,
                perQuestion: perQuestion as unknown as Prisma.InputJsonValue,
                totalScore,
                clientId,
            },
            select: { id: true },
        });

        return Response.json(
            { attemptId: attempt.id, totalScore, perQuestion },
            { status: 201 },
        );
    } catch (error) {
        if (
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === 'P2002'
        ) {
            // Duplicate offline-idempotency key for this user (Req 21 seam; full
            // idempotent sync is task 18.1).
            return errorResponse(
                409,
                ErrorCode.CONFLICT,
                'A PYQ attempt with this clientId has already been recorded.',
                { field: 'clientId' },
            );
        }
        throw error;
    }
}

/** Framework route context for the dynamic `/:id` segment. */
export interface PyqAttemptRouteContext {
    params: { id: string };
}

/**
 * Handle `GET /api/pyq-attempts/:id`. Loads the attempt and enforces per-user ownership:
 * an attempt owned by another user (or a missing attempt) yields `404 NOT_FOUND` so the
 * existence of other users' attempts is not revealed. `assertOwnership` additionally guards
 * against returning a record the caller does not own.
 */
export async function getPyqAttemptHandler(
    _request: Request,
    auth: AuthContext,
    routeContext: PyqAttemptRouteContext,
): Promise<Response> {
    const { id } = routeContext.params;
    if (typeof id !== 'string' || id.trim() === '') {
        return errorResponse(422, ErrorCode.VALIDATION_ERROR, 'An attempt id is required.', {
            field: 'id',
        });
    }

    const attempt = await prisma.pYQAttempt.findUnique({ where: { id } });

    if (!attempt || attempt.userId !== auth.user.id) {
        // Do not leak the existence of another user's attempt.
        return errorResponse(404, ErrorCode.NOT_FOUND, 'PYQ attempt not found.');
    }

    // Defensive ownership assertion (becomes 403 inside withAuth if it ever fails).
    assertOwnership(attempt.userId, auth.user.id);

    return Response.json({ attempt });
}
