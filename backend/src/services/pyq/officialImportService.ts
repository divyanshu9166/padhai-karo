import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { AuthContext } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { ErrorCode, errorResponse } from '@/lib/errors';
import { findPaperDefinition, getExamProgram, type ExamStage } from '@/lib/exams';
import { requireOperatorKey } from '@/lib/operatorAuth';

function text(value: unknown): string { return typeof value === 'string' ? value.trim() : ''; }
function object(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }

export async function importOfficialPyqHandler(request: Request, auth: AuthContext): Promise<Response> {
    const accessError = requireOperatorKey(request);
    if (accessError) return accessError;
    let input: Record<string, unknown>; try { input = object(await request.json()); } catch { input = {}; }
    const program: 'UPSC_CSE' | 'SSC_CGL' | null = input.program === 'UPSC_CSE' || input.program === 'SSC_CGL' ? input.program : null;
    const stage = text(input.stage); const year = typeof input.year === 'number' ? Math.floor(input.year) : NaN;
    const paperKey = text(input.paperKey);
    const questions = Array.isArray(input.questions) ? input.questions : [];
    const answerEntries = object(input.answerKey);
    const sourceUrl = text(input.sourceUrl);
    const answerKeyUrl = text(input.answerKeyUrl);
    if (!program || !stage || !Number.isInteger(year) || !paperKey || questions.length === 0 || questions.length > 500 || !sourceUrl || !answerKeyUrl || Object.keys(answerEntries).length === 0) return errorResponse(422, ErrorCode.VALIDATION_ERROR, 'program, stage, year, paperKey, sourceUrl, answerKeyUrl, answerKey and questions are required.');
    if (!(getExamProgram(program).stages as readonly string[]).includes(stage)) return errorResponse(422, ErrorCode.VALIDATION_ERROR, 'The selected stage is not valid for the program.', { field: 'stage' });
    const paperDefinition = findPaperDefinition(program, stage as ExamStage, paperKey);
    if (!paperDefinition || paperDefinition.questionFormat !== 'MCQ' || !paperDefinition.questionCount) return errorResponse(422, ErrorCode.VALIDATION_ERROR, 'paperKey must identify a known UPSC/SSC objective paper.', { field: 'paperKey' });
    try {
        const parsed = new URL(sourceUrl);
        const host = parsed.hostname.toLowerCase();
        const official = ['upsc.gov.in', 'ssc.gov.in'].some((allowed) => host === allowed || host.endsWith('.' + allowed));
        if (parsed.protocol !== 'https:' || !official) return errorResponse(422, ErrorCode.VALIDATION_ERROR, 'sourceUrl must be an HTTPS URL hosted by an approved official source.');
    } catch { return errorResponse(422, ErrorCode.VALIDATION_ERROR, 'sourceUrl must be a valid HTTPS URL.'); }
    try {
        const parsed = new URL(answerKeyUrl);
        const host = parsed.hostname.toLowerCase();
        const official = ['upsc.gov.in', 'ssc.gov.in'].some((allowed) => host === allowed || host.endsWith('.' + allowed));
        if (parsed.protocol !== 'https:' || !official) return errorResponse(422, ErrorCode.VALIDATION_ERROR, 'answerKeyUrl must be an HTTPS URL hosted by an approved official source.');
    } catch { return errorResponse(422, ErrorCode.VALIDATION_ERROR, 'answerKeyUrl must be a valid HTTPS URL.'); }
    const questionRefs = questions.map((value, index) => {
        const row = object(value);
        return text(row.questionRef) || String(index + 1);
    });
    const uniqueQuestionRefs = new Set(questionRefs);
    if (uniqueQuestionRefs.size !== questionRefs.length || Object.keys(answerEntries).length !== questionRefs.length || questionRefs.some((ref) => !Object.prototype.hasOwnProperty.call(answerEntries, ref))) {
        return errorResponse(422, ErrorCode.VALIDATION_ERROR, 'Every question must have one unique questionRef with exactly one matching final answer-key entry.');
    }
    const normalized: Array<{ questionText: string; options: string[]; correctOption: number; subjectId: string }> = [];
    for (let index = 0; index < questions.length; index += 1) {
        const row = object(questions[index]); const questionText = text(row.questionText); const options = Array.isArray(row.options) ? row.options.filter((v): v is string => typeof v === 'string').map((v) => v.trim()) : [];
        const ref = text(row.questionRef) || String(index + 1); const answerKeyValue = answerEntries[ref]; const keyValue = row.correctOption ?? answerKeyValue;
        const numericCorrectOption = typeof keyValue === 'number' ? keyValue : Number(keyValue);
        const numericAnswerKey = typeof answerKeyValue === 'number' ? answerKeyValue : Number(answerKeyValue);
        const correctOption = Number.isFinite(numericCorrectOption) ? Math.floor(numericCorrectOption) : NaN;
        if (answerKeyValue === undefined || !Number.isInteger(numericAnswerKey) || !questionText || options.length !== 4 || !Number.isInteger(correctOption) || correctOption < 0 || correctOption > 3 || numericAnswerKey !== correctOption) return errorResponse(422, ErrorCode.VALIDATION_ERROR, 'Every question must have exactly four options and a final answer-key match.', { question: index + 1, questionRef: ref });
        const subjectId = text(row.subjectId); const subject = await prisma.subject.findFirst({ where: { id: subjectId, examTrack: program === 'UPSC_CSE' ? 'UPSC' : 'SSC' }, select: { id: true } });
        if (!subject) return errorResponse(422, ErrorCode.VALIDATION_ERROR, 'Each question needs a valid UPSC/SSC subjectId.', { question: index + 1 });
        normalized.push({ questionText, options, correctOption, subjectId });
    }
    const result = await prisma.$transaction(async (tx) => {
        const existing = await tx.pYQPaper.findFirst({ where: { examProgram: program, paperKey, year } });
        const answerKeyId = existing?.answerKeyId ?? randomUUID();
        const data = { examTrack: program === 'UPSC_CSE' ? 'UPSC' as const : 'SSC' as const, examProgram: program, examStage: stage as never, paperKey, year, session: text(input.session) || undefined, durationMin: typeof input.durationMin === 'number' ? Math.max(1, Math.floor(input.durationMin)) : 120, answerKeyId, sourceName: text(input.sourceName) || 'Official final answer key', sourceUrl, answerKeyUrl, verificationMethod: 'OFFICIAL_FINAL_KEY_CROSS_CHECK', verifiedAt: new Date() };
        const paper = existing ? await tx.pYQPaper.update({ where: { id: existing.id }, data }) : await tx.pYQPaper.create({ data: { id: randomUUID(), ...data } });
        await tx.answerKey.upsert({ where: { paperId: paper.id }, create: { id: answerKeyId, paperId: paper.id, entries: answerEntries as Prisma.InputJsonValue }, update: { entries: answerEntries as Prisma.InputJsonValue } });
        await tx.pYQ.deleteMany({ where: { paperId: paper.id } });
        await tx.pYQ.createMany({ data: normalized.map((question) => ({ paperId: paper.id, examTrack: paper.examTrack, examProgram: program, examStage: stage as never, year, subjectId: question.subjectId, questionText: question.questionText, options: question.options, correctOption: question.correctOption })) });
        return paper;
    });
    return Response.json({ paper: result, importedQuestions: normalized.length, verified: true, importedBy: auth.user.id }, { status: 201 });
}
