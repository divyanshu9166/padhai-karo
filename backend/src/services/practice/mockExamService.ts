import { Prisma } from '@prisma/client';
import type { AuthContext } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { ErrorCode, errorResponse } from '@/lib/errors';
import { findPaperDefinition } from '@/lib/exams';
import type { ExamProgramKey, ExamStage, PaperDefinition } from '@/lib/exams';
import { scoreMockQuestions } from '@/lib/upscc/mockScoring';

function text(value: unknown): string { return typeof value === 'string' ? value.trim() : ''; }
function object(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }

async function questionSet(userId: string, paperId?: string, program?: ExamProgramKey, stage?: ExamStage, limit = 100): Promise<Array<{ id: string; questionText: string; options: string[]; correctOption: number; subjectId: string; year: number }>> {
    void userId;
    if (!paperId) return [];
    return prisma.pYQ.findMany({
        where: { paperId, examTrack: program === 'UPSC_CSE' ? 'UPSC' : 'SSC', examProgram: program, examStage: stage, flaggedForReview: false },
        orderBy: { year: 'desc' },
        take: Math.max(1, Math.min(200, limit)),
        select: { id: true, questionText: true, options: true, correctOption: true, subjectId: true, year: true },
    });
}

function publicQuestions(questions: Awaited<ReturnType<typeof questionSet>>) {
    return questions.map(({ correctOption: _correctOption, ...question }) => question);
}

type MockSection = { questionCount: number; durationSec: number; questionIds: string[] };

function sectionTimings(questions: Awaited<ReturnType<typeof questionSet>>, durationSec: number): Record<string, MockSection> {
    const groups = new Map<string, string[]>();
    for (const question of questions) groups.set(question.subjectId, [...(groups.get(question.subjectId) ?? []), question.id]);
    const totalDuration = Math.max(durationSec, groups.size * 60);
    let allocated = 0;
    const entries = [...groups.entries()];
    return Object.fromEntries(entries.map(([subjectId, questionIds], index) => {
        const sectionDuration = index === entries.length - 1
            ? Math.max(60, totalDuration - allocated)
            : Math.max(60, Math.round(totalDuration * questionIds.length / Math.max(1, questions.length)));
        allocated += sectionDuration;
        return [subjectId, { questionCount: questionIds.length, durationSec: sectionDuration, questionIds }];
    }));
}

async function questionSetByIds(ids: readonly string[], paperId: string, program: ExamProgramKey, stage: ExamStage) {
    if (ids.length === 0) return [];
    const rows = await prisma.pYQ.findMany({
        where: { id: { in: [...new Set(ids)] }, paperId, examTrack: program === 'UPSC_CSE' ? 'UPSC' : 'SSC', examProgram: program, examStage: stage, flaggedForReview: false },
        select: { id: true, questionText: true, options: true, correctOption: true, subjectId: true, year: true },
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    return ids.flatMap((id) => { const row = byId.get(id); return row ? [row] : []; });
}

function marksPerQuestion(paper: PaperDefinition | undefined, questionCount: number): number {
    if (paper?.maxMarks && paper.questionCount) return paper.maxMarks / paper.questionCount;
    return paper?.maxMarks && questionCount > 0 ? paper.maxMarks / questionCount : 1;
}

function negativeMarking(paper: PaperDefinition | undefined): PaperDefinition['negativeMarking'] {
    return paper?.negativeMarking ?? { kind: 'NONE' };
}

function safeAnswers(value: unknown, questionIds: ReadonlySet<string>): Record<string, number | null> {
    const raw = object(value);
    return Object.fromEntries(Object.entries(raw).filter(([id]) => questionIds.has(id)).map(([id, selected]) => [id, Number.isInteger(selected) && Number(selected) >= 0 && Number(selected) < 4 ? Number(selected) : null]));
}

function mockDeadline(attempt: { createdAt: Date; durationSec: number }): number {
    return attempt.createdAt.getTime() + Math.max(1, attempt.durationSec) * 1000;
}

export async function startMockExamHandler(request: Request, auth: AuthContext): Promise<Response> {
    let input: Record<string, unknown>; try { input = object(await request.json()); } catch { input = {}; }
    const paperId = text(input.paperId) || undefined;
    const profile = await prisma.profile.findUnique({ where: { userId: auth.user.id }, select: { examProgram: true, examStage: true } });
    const program = profile?.examProgram as ExamProgramKey | null | undefined;
    const stage = profile?.examStage as ExamStage | null | undefined;
    if (!program || !stage) return errorResponse(422, ErrorCode.VALIDATION_ERROR, 'Complete UPSC/SSC onboarding before starting a full mock.');
    const selectedPaper = paperId
        ? await prisma.pYQPaper.findFirst({ where: { id: paperId, examProgram: program, examStage: stage, verifiedAt: { not: null }, answerKey: { isNot: null } }, select: { id: true, paperKey: true, durationMin: true, year: true } })
        : await prisma.pYQPaper.findFirst({ where: { examProgram: program, examStage: stage, verifiedAt: { not: null }, answerKey: { isNot: null } }, orderBy: { year: 'desc' }, select: { id: true, paperKey: true, durationMin: true, year: true } });
    const effectivePaperId = selectedPaper?.id;
    const paperDefinition = findPaperDefinition(program, stage, selectedPaper?.paperKey);
    if (!paperDefinition || paperDefinition.questionFormat !== 'MCQ' || !paperDefinition.questionCount) {
        return errorResponse(409, ErrorCode.CONFLICT, 'This paper is not mapped to a known UPSC/SSC scoring structure yet.', { paperId: selectedPaper?.id ?? null });
    }
    const questionLimit = paperDefinition.questionCount;
    const questions = await questionSet(auth.user.id, effectivePaperId, program, stage, questionLimit);
    if (questions.length === 0) return errorResponse(404, ErrorCode.NOT_FOUND, 'No verified questions are available for this mock yet.');
    if (paperDefinition?.questionCount && questions.length < paperDefinition.questionCount) {
        return errorResponse(409, ErrorCode.CONFLICT, `This verified paper is incomplete for full-mock mode (${questions.length}/${paperDefinition.questionCount} questions imported).`, { available: questions.length, expected: paperDefinition.questionCount, paperId: effectivePaperId });
    }
    const requestedDurationSec = typeof input.durationSec === 'number' && input.durationSec > 0 ? Math.floor(input.durationSec) : (selectedPaper?.durationMin ?? paperDefinition?.durationMin ?? 120) * 60;
    const sectionCount = new Set(questions.map((question) => question.subjectId)).size;
    const durationSec = Math.max(requestedDurationSec, sectionCount * 60);
    const answers = Object.fromEntries(questions.map((question) => [question.id, null]));
    const marks = marksPerQuestion(paperDefinition, questions.length);
    const sectionData = sectionTimings(questions, durationSec);
    const metadata = { paperId: effectivePaperId, paperKey: paperDefinition?.key ?? selectedPaper?.paperKey ?? null, program, stage, questionIds: questions.map((question) => question.id), sectionOrder: Object.keys(sectionData), marksPerQuestion: marks, negativeMarking: negativeMarking(paperDefinition), maximumScore: questions.length * marks };
    const attempt = await prisma.mockExamAttempt.create({ data: { userId: auth.user.id, paperId: effectivePaperId, title: text(input.title) || `${program} ${stage} full mock`, durationSec, answers: answers as Prisma.InputJsonValue, markedForReview: [] as unknown as Prisma.InputJsonValue, sectionTimings: { ...sectionData, __meta: metadata } as Prisma.InputJsonValue, maxScore: Math.round(questions.length * marks), maximumScore: questions.length * marks } });
    return Response.json({ attempt, questions: publicQuestions(questions), mode: 'FULL_MOCK', scoring: metadata }, { status: 201 });
}

export interface MockRouteContext { params: { id: string } | Promise<{ id: string }> }

export async function saveMockExamHandler(request: Request, auth: AuthContext, context: MockRouteContext): Promise<Response> {
    const { id } = await context.params; let input: Record<string, unknown>; try { input = object(await request.json()); } catch { input = {}; }
    const existing = await prisma.mockExamAttempt.findFirst({ where: { id, userId: auth.user.id, status: 'IN_PROGRESS' } });
    if (!existing) return errorResponse(404, ErrorCode.NOT_FOUND, 'Active mock attempt not found.');
    if (Date.now() >= mockDeadline(existing)) return errorResponse(409, ErrorCode.CONFLICT, 'The mock time limit has expired; submit the attempt to see its score.');
    const storedMeta = object(object(existing.sectionTimings).__meta);
    const storedQuestionIds = Array.isArray(storedMeta.questionIds) ? storedMeta.questionIds.filter((value): value is string => typeof value === 'string') : [];
    const questionIds = new Set(storedQuestionIds);
    const answers = input.answers && typeof input.answers === 'object' ? safeAnswers(input.answers, questionIds) : existing.answers as Record<string, number | null>;
    const markedForReview = Array.isArray(input.markedForReview) ? input.markedForReview.filter((v): v is string => typeof v === 'string' && questionIds.has(v)) : existing.markedForReview as string[];
    // `sectionTimings.__meta` contains the server-owned question set and
    // scoring contract. Never let a client overwrite it while saving UI
    // progress; doing so would make the later submit query user-controlled.
    const attempt = await prisma.mockExamAttempt.update({ where: { id }, data: { answers: answers as Prisma.InputJsonValue, markedForReview: markedForReview as Prisma.InputJsonValue, currentQuestion: typeof input.currentQuestion === 'number' ? Math.max(0, Math.min(Math.max(0, questionIds.size - 1), Math.floor(input.currentQuestion))) : undefined } });
    return Response.json({ attempt });
}

export async function submitMockExamHandler(request: Request, auth: AuthContext, context: MockRouteContext): Promise<Response> {
    const { id } = await context.params; let input: Record<string, unknown>; try { input = object(await request.json()); } catch { input = {}; }
    const existing = await prisma.mockExamAttempt.findFirst({ where: { id, userId: auth.user.id, status: 'IN_PROGRESS' } });
    if (!existing) return errorResponse(404, ErrorCode.NOT_FOUND, 'Active mock attempt not found.');
    const storedMeta = object(object(existing.sectionTimings).__meta);
    const program = typeof storedMeta.program === 'string' ? storedMeta.program as ExamProgramKey : undefined;
    const stage = typeof storedMeta.stage === 'string' ? storedMeta.stage as ExamStage : undefined;
    const paperId = typeof storedMeta.paperId === 'string' ? storedMeta.paperId : undefined;
    const storedQuestionIds = Array.isArray(storedMeta.questionIds) ? storedMeta.questionIds.filter((value): value is string => typeof value === 'string') : [];
    if (!paperId || !program || !stage || storedQuestionIds.length === 0) return errorResponse(409, ErrorCode.CONFLICT, 'This mock attempt is missing its fixed question set and cannot be scored safely.');
    const questions = await questionSetByIds(storedQuestionIds, paperId, program, stage);
    if (questions.length !== storedQuestionIds.length) return errorResponse(409, ErrorCode.CONFLICT, 'Some questions in this mock are no longer practice-eligible; start a new mock.');
    const answers = safeAnswers(input.answers ?? existing.answers, new Set(storedQuestionIds));
    const perQuestion = questions.map((question) => {
        const selected = answers[question.id];
        const outcome = selected === null || selected === undefined ? 'UNANSWERED' : Number(selected) === question.correctOption ? 'CORRECT' : 'INCORRECT';
        return { questionId: question.id, outcome };
    });
    const totalScore = perQuestion.filter((row) => row.outcome === 'CORRECT').length;
    const marks = typeof storedMeta.marksPerQuestion === 'number' ? storedMeta.marksPerQuestion : 1;
    const marking = storedMeta.negativeMarking && typeof storedMeta.negativeMarking === 'object' ? storedMeta.negativeMarking as PaperDefinition['negativeMarking'] : { kind: 'NONE' as const };
    const score = scoreMockQuestions(questions, answers, marks, marking);
    const attempt = await prisma.mockExamAttempt.update({ where: { id }, data: { answers: answers as Prisma.InputJsonValue, status: 'SUBMITTED', submittedAt: new Date(), totalScore, maxScore: Math.round(score.maximumScore), obtainedScore: score.obtainedScore, maximumScore: score.maximumScore, correctCount: score.correctCount, incorrectCount: score.incorrectCount, unansweredCount: score.unansweredCount, negativeMarks: score.negativeMarks } });
    return Response.json({ attempt, timedOut: Date.now() >= mockDeadline(existing), perQuestion, scorePercent: score.maximumScore === 0 ? 0 : Math.round(Math.max(0, score.obtainedScore) / score.maximumScore * 100), score });
}

export async function getMockHistoryHandler(_request: Request, auth: AuthContext): Promise<Response> {
    return Response.json({ attempts: await prisma.mockExamAttempt.findMany({ where: { userId: auth.user.id }, orderBy: { createdAt: 'desc' }, take: 50 }) });
}

export async function createPacingAttemptHandler(request: Request, auth: AuthContext): Promise<Response> {
    let input: Record<string, unknown>; try { input = object(await request.json()); } catch { input = {}; }
    const values = ['questionCount', 'targetSeconds', 'actualSeconds', 'correct', 'skipped'].map((key) => typeof input[key] === 'number' ? Math.floor(input[key] as number) : NaN);
    if (values.some((value) => !Number.isInteger(value) || value < 0) || values[0] < 1 || values[1] < 1) return errorResponse(422, ErrorCode.VALIDATION_ERROR, 'Provide non-negative pacing metrics and a positive question count/target.');
    const [questionCount, targetSeconds, actualSeconds, correct, skipped] = values;
    if (correct + skipped > questionCount) return errorResponse(422, ErrorCode.VALIDATION_ERROR, 'correct + skipped cannot exceed questionCount.');
    const attempt = await prisma.pacingAttempt.create({ data: { userId: auth.user.id, questionCount, targetSeconds, actualSeconds, correct, skipped, subjectId: text(input.subjectId) || undefined, notes: text(input.notes) || undefined } });
    return Response.json({ attempt, pacing: { targetSecondsPerQuestion: targetSeconds / questionCount, actualSecondsPerQuestion: actualSeconds / questionCount, accuracyPercent: correct / questionCount * 100 } }, { status: 201 });
}

export async function listPacingAttemptsHandler(_request: Request, auth: AuthContext): Promise<Response> {
    return Response.json({ attempts: await prisma.pacingAttempt.findMany({ where: { userId: auth.user.id }, orderBy: { createdAt: 'desc' }, take: 50 }) });
}
