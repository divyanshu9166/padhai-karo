/**
 * Timed Paper Mode service (task 13.1, design "Timed Paper Mode Service").
 *
 * Implements the three endpoints from the design table:
 *
 *   GET /api/papers/:id
 *     -> 200 { paper, durationMin, questions[] }                      (Req 19.1)
 *     -> 404 NOT_FOUND (paper missing)
 *
 *   POST /api/timed-attempts
 *     body: { paperId, answers: [{ questionId, selectedOption? }], timeTakenSec, clientId? }
 *     -> 201 { attemptId, totalScore, perQuestion[] }                 (Req 19.5, 19.6, 19.7)
 *     -> 422 VALIDATION_ERROR (bad body)
 *     -> 404 NOT_FOUND (paper has no practice-eligible questions)
 *     -> 409 CONFLICT (a prior attempt used the same clientId)        (Req 21 seam)
 *
 *   GET /api/timed-attempts/:id
 *     -> 200 { attempt }                                              (Req 19.7)
 *     -> 404 NOT_FOUND / 403 FORBIDDEN (per-user ownership)
 *
 * Server-side answer key (Req 19.5/19.6): the correct answer is NEVER taken from the
 * client. The handler loads the paper's PYQ rows by `paperId` and builds the answer key
 * from their stored `correctOption`. Scoring is delegated to the shared pure
 * {@link scoreAttempt} function (task 11.1) so PYQ practice and Timed Paper Mode score
 * identically. Crucially, timed scoring covers EVERY question of the paper — the answer
 * key (the full paper), not the submitted answers, drives the scored set — so a question
 * the user never reached is absent from `answers` and is scored `UNANSWERED` and counted
 * incorrect (Req 19.5/19.6).
 *
 * Practice eligibility (Req 7.3): questions flagged for manual review are excluded from
 * BOTH the `GET /papers/:id` listing and the scored set, so the paper a user sees and the
 * paper that is scored are exactly the same set of questions.
 *
 * Mistake-journal eligibility (Req 19.8): the persisted `perQuestion` JSON records, for
 * every question, `{ questionId, selectedOption, correctOption, outcome }`. A question is
 * "incorrect" — and therefore journal-eligible — exactly when its `outcome` is
 * `INCORRECT`. The mistake-journal service (task 14.1) reads a stored attempt by id and
 * may flag any such entry: `questionId` identifies the question, `correctOption` supplies
 * the journal entry's correct answer, and `selectedOption` supplies the submitted answer.
 * Unanswered questions (`outcome === 'UNANSWERED'`) count as incorrect toward the score
 * but are intentionally labeled distinctly and are not themselves flagged as wrong answers.
 *
 * Availability: like PYQ practice, timed-paper submission performs no tier gating; the only
 * access control is the `withAuth` session guard that wraps the route, and every read/write
 * is scoped to `ctx.user.id`.
 *
 * clientId idempotency (documented decision): this endpoint relies on the
 * `@@unique([userId, clientId])` constraint and, on a duplicate replay, returns
 * `409 CONFLICT` (mirroring the PYQ-attempt and focus-session handlers). Full
 * read-your-prior-result idempotent sync is task 18.1 (`POST /sync`).
 *
 * The answer-key assembly and scoring orchestration are kept as small pure functions
 * ({@link buildAnswerKey}, {@link scoreTimedAttempt}) so they are unit-testable without a
 * live database (the question lookup is injected directly).
 */
import { Prisma } from '@prisma/client';

import type { AuthContext } from '@/lib/auth';
import { assertOwnership } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { ErrorCode, errorResponse } from '@/lib/errors';
import type { AnswerKeyEntry, PerQuestionResult } from '@/lib/scoring';
import { scoreAttempt } from '@/lib/scoring';

import type { NormalizedTimedAnswer, ValidatedTimedAttempt } from './timedPaperValidation';
import { validateTimedAttemptInput } from './timedPaperValidation';

/** The minimal PYQ row shape needed to assemble an answer key: its id and correct option. */
export interface PaperAnswerSource {
    id: string;
    correctOption: number;
}

/**
 * The shape returned to the client for a single question in the paper listing. Note the
 * absence of `correctOption` (and any other answer-revealing field): the timed-paper
 * answer sheet must not let a client read the key before submitting.
 */
export interface ClientPaperQuestion {
    id: string;
    questionText: string;
    options: string[];
}

/**
 * Prisma `select` for the paper listing. Restricts the columns fetched to exactly the safe
 * client projection so `correctOption` is never read out of the database for the listing.
 * Kept in sync with {@link ClientPaperQuestion}.
 */
export const PAPER_QUESTION_CLIENT_SELECT = {
    id: true,
    questionText: true,
    options: true,
} as const satisfies Prisma.PYQSelect;

/**
 * Build the official answer key from the loaded PYQ rows (Req 19.5). The integer
 * `correctOption` (a 0-based option index) is stringified so it shares the string-keyed
 * shape the pure {@link scoreAttempt} compares against; the client's selected option is
 * stringified the same way in {@link scoreTimedAttempt}, so equal indices compare equal.
 *
 * The answer key — i.e. the full set of the paper's questions — defines what gets scored.
 * A submitted answer for a question id not in the paper is therefore ignored, and a paper
 * question with no submitted answer is scored `UNANSWERED`.
 */
export function buildAnswerKey(questions: ReadonlyArray<PaperAnswerSource>): AnswerKeyEntry[] {
    return questions.map((question) => ({
        questionId: question.id,
        correctOption: String(question.correctOption),
    }));
}

/** The result of scoring an attempt: per-question outcomes (key order) and the total. */
export interface TimedScoreResult {
    perQuestion: PerQuestionResult[];
    totalScore: number;
}

/**
 * Orchestrate scoring of a validated attempt against the loaded paper questions
 * (Req 19.5/19.6). Builds the server-side answer key from EVERY question of the paper,
 * stringifies each selected option to match, and delegates to the shared
 * {@link scoreAttempt}. Pure: no I/O, so it is unit-testable by passing in question rows
 * directly — including the "never reached -> unanswered -> incorrect" case.
 */
export function scoreTimedAttempt(
    answers: ReadonlyArray<NormalizedTimedAnswer>,
    questions: ReadonlyArray<PaperAnswerSource>,
): TimedScoreResult {
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

/** Framework route context for the dynamic `/:id` segment. */
export interface IdRouteContext {
    params: { id: string };
}

/**
 * Handle `GET /api/papers/:id`. Returns the paper's standard duration and its
 * practice-eligible questions WITHOUT the answer key (no `correctOption`). Flagged-for-
 * review questions are excluded so the listing matches the scored set exactly (Req 7.3).
 */
export async function getPaperHandler(
    _request: Request,
    _auth: AuthContext,
    routeContext: IdRouteContext,
): Promise<Response> {
    const { id } = routeContext.params;
    if (typeof id !== 'string' || id.trim() === '') {
        return errorResponse(422, ErrorCode.VALIDATION_ERROR, 'A paper id is required.', {
            field: 'id',
        });
    }

    const paper = await prisma.pYQPaper.findUnique({
        where: { id },
        select: { id: true, examTrack: true, year: true, session: true, durationMin: true },
    });

    if (!paper) {
        return errorResponse(404, ErrorCode.NOT_FOUND, 'Paper not found.');
    }

    const questions = await prisma.pYQ.findMany({
        where: { paperId: id, flaggedForReview: false },
        select: PAPER_QUESTION_CLIENT_SELECT,
        orderBy: { id: 'asc' },
    });

    return Response.json({
        paper: {
            id: paper.id,
            examTrack: paper.examTrack,
            year: paper.year,
            session: paper.session,
        },
        durationMin: paper.durationMin,
        questions,
    });
}

/** Load the paper's practice-eligible PYQ rows (id + correctOption) for scoring. */
async function loadPaperAnswerSources(paperId: string): Promise<PaperAnswerSource[]> {
    return prisma.pYQ.findMany({
        where: { paperId, flaggedForReview: false },
        select: { id: true, correctOption: true },
        orderBy: { id: 'asc' },
    });
}

/**
 * Handle `POST /api/timed-attempts`. Validates the body, resolves the server-side answer
 * key from the paper's stored PYQ rows, scores EVERY question via the shared pure function
 * (unreached questions -> UNANSWERED -> counted incorrect), and persists a
 * `TimedPaperAttempt` scoped to the authenticated user. The route file wraps this with
 * `withAuth` so unauthenticated requests are rejected upstream.
 */
export async function createTimedAttemptHandler(
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

    const validation = validateTimedAttemptInput(body as Record<string, unknown>);
    if (!validation.ok) {
        return errorResponse(
            422,
            ErrorCode.VALIDATION_ERROR,
            validation.message,
            validation.details,
        );
    }

    const { paperId, answers, timeTakenSec, clientId }: ValidatedTimedAttempt = validation.value;

    // Resolve the answer key SERVER-SIDE from the paper's stored PYQ rows (never from the
    // client). This is the FULL paper, so every question is scored (Req 19.5).
    const questions = await loadPaperAnswerSources(paperId);
    if (questions.length === 0) {
        return errorResponse(
            404,
            ErrorCode.NOT_FOUND,
            'Paper not found or has no practice-eligible questions.',
            { field: 'paperId' },
        );
    }

    const { perQuestion, totalScore } = scoreTimedAttempt(answers, questions);

    try {
        const attempt = await prisma.timedPaperAttempt.create({
            data: {
                userId: auth.user.id,
                paperId,
                perQuestion: perQuestion as unknown as Prisma.InputJsonValue,
                totalScore,
                timeTakenSec,
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
                'A timed-paper attempt with this clientId has already been recorded.',
                { field: 'clientId' },
            );
        }
        throw error;
    }
}

/**
 * Handle `GET /api/timed-attempts/:id`. Loads the attempt and enforces per-user ownership:
 * an attempt owned by another user (or a missing attempt) yields `404 NOT_FOUND` so the
 * existence of other users' attempts is not revealed. `assertOwnership` additionally guards
 * against returning a record the caller does not own.
 */
export async function getTimedAttemptHandler(
    _request: Request,
    auth: AuthContext,
    routeContext: IdRouteContext,
): Promise<Response> {
    const { id } = routeContext.params;
    if (typeof id !== 'string' || id.trim() === '') {
        return errorResponse(422, ErrorCode.VALIDATION_ERROR, 'An attempt id is required.', {
            field: 'id',
        });
    }

    const attempt = await prisma.timedPaperAttempt.findUnique({ where: { id } });

    if (!attempt || attempt.userId !== auth.user.id) {
        // Do not leak the existence of another user's attempt.
        return errorResponse(404, ErrorCode.NOT_FOUND, 'Timed-paper attempt not found.');
    }

    // Defensive ownership assertion (becomes 403 inside withAuth if it ever fails).
    assertOwnership(attempt.userId, auth.user.id);

    return Response.json({ attempt });
}
