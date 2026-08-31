/**
 * Import a verified UPSC/SSC paper prepared from an official question-paper + final-key
 * pair. The repository intentionally contains no copied question corpus; run with
 * OFFICIAL_PYQ_FILE=./data/official-pyq.json after the operator has downloaded and checked
 * the official documents.
 */
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PrismaClient, type ExamProgram, type ExamStage, type ExamTrack, Prisma } from '@prisma/client';
import { findPaperDefinition } from '../src/lib/exams';

const prisma = new PrismaClient();
const OFFICIAL_HOSTS = ['upsc.gov.in', 'ssc.gov.in'];

type Input = {
    program: ExamProgram;
    stage: ExamStage;
    year: number;
    paperKey: string;
    durationMin?: number;
    sourceName: string;
    sourceUrl: string;
    answerKeyUrl: string;
    reviewedAt?: string;
    questionPaperSha256?: string;
    answerKeySha256?: string;
    answerKey: Record<string, number>;
    questions: Array<{ questionRef?: string; questionText: string; options: string[]; subjectId: string; correctOption?: number }>;
};

function fail(message: string): never { throw new Error(`Official PYQ import rejected: ${message}`); }
function asObject(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }

function parseInput(raw: unknown): Input {
    const input = asObject(raw);
    const program = input.program === 'UPSC_CSE' || input.program === 'SSC_CGL' ? input.program : fail('program must be UPSC_CSE or SSC_CGL');
    const stage = typeof input.stage === 'string' ? input.stage as ExamStage : fail('stage is required');
    if ((program === 'UPSC_CSE' && !['PRELIMS', 'MAINS'].includes(stage)) || (program === 'SSC_CGL' && !['TIER_1', 'TIER_2'].includes(stage))) fail('stage is not valid for the selected exam program');
    const year = typeof input.year === 'number' && Number.isInteger(input.year) ? input.year : fail('year is required');
    const paperKey = typeof input.paperKey === 'string' && input.paperKey.trim() ? input.paperKey.trim() : fail('paperKey is required for idempotent imports');
    const paperDefinition = findPaperDefinition(program, stage, paperKey);
    if (!paperDefinition || paperDefinition.questionFormat !== 'MCQ' || !paperDefinition.questionCount) fail('paperKey must identify a known UPSC/SSC objective paper');
    const sourceName = typeof input.sourceName === 'string' ? input.sourceName.trim() : '';
    const sourceUrl = typeof input.sourceUrl === 'string' ? input.sourceUrl.trim() : '';
    const answerKeyUrl = typeof input.answerKeyUrl === 'string' ? input.answerKeyUrl.trim() : '';
    let parsedUrl: URL;
    try { parsedUrl = new URL(sourceUrl); } catch { fail('sourceUrl must be a URL'); }
    const host = parsedUrl.hostname.toLowerCase();
    if (parsedUrl.protocol !== 'https:' || !OFFICIAL_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))) fail('sourceUrl must be an HTTPS UPSC or SSC URL');
    let parsedAnswerKeyUrl: URL;
    try { parsedAnswerKeyUrl = new URL(answerKeyUrl); } catch { fail('answerKeyUrl must be a URL'); }
    const answerKeyHost = parsedAnswerKeyUrl.hostname.toLowerCase();
    if (parsedAnswerKeyUrl.protocol !== 'https:' || !OFFICIAL_HOSTS.some((allowed) => answerKeyHost === allowed || answerKeyHost.endsWith(`.${allowed}`))) fail('answerKeyUrl must be an HTTPS UPSC or SSC URL');
    const answerKey = asObject(input.answerKey);
    const questions = Array.isArray(input.questions) ? input.questions.map((item) => asObject(item)).map((item) => ({ questionRef: typeof item.questionRef === 'string' ? item.questionRef.trim() : undefined, questionText: typeof item.questionText === 'string' ? item.questionText.trim() : '', options: Array.isArray(item.options) ? item.options.filter((option): option is string => typeof option === 'string').map((option) => option.trim()) : [], subjectId: typeof item.subjectId === 'string' ? item.subjectId.trim() : '', correctOption: typeof item.correctOption === 'number' ? item.correctOption : undefined })) : [];
    if (questions.length === 0 || questions.length > 500) fail('1 to 500 questions are required');
    if (Object.keys(answerKey).length !== questions.length) fail('answerKey must contain one entry per question');
    const questionRefs = questions.map((question, index) => question.questionRef || String(index + 1));
    if (new Set(questionRefs).size !== questionRefs.length || questionRefs.some((ref) => !Object.prototype.hasOwnProperty.call(answerKey, ref))) fail('questionRef values must be unique and must exactly match the answerKey entries');
    for (let index = 0; index < questions.length; index += 1) {
        const question = questions[index];
        const ref = question.questionRef || String(index + 1);
        const answer = answerKey[ref];
        if (!question.questionText || question.options.length !== 4 || typeof answer !== 'number' || !Number.isInteger(answer) || answer < 0 || answer > 3 || (question.correctOption !== undefined && question.correctOption !== answer)) fail(`question ${ref} must have four options and a matching final answer key`);
    }
    const reviewedAt = input.reviewedAt === undefined ? undefined : (typeof input.reviewedAt === 'string' && !Number.isNaN(new Date(input.reviewedAt).getTime()) ? input.reviewedAt : fail('reviewedAt must be a valid ISO date'));
    const sha256 = (value: unknown, field: string): string | undefined => value === undefined ? undefined : (typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value) ? value.toLowerCase() : fail(`${field} must be a SHA-256 hex digest`));
    return { program, stage, year, paperKey, durationMin: typeof input.durationMin === 'number' ? Math.max(1, Math.floor(input.durationMin)) : 120, sourceName: sourceName || 'Official final answer key', sourceUrl, answerKeyUrl, reviewedAt, questionPaperSha256: sha256(input.questionPaperSha256, 'questionPaperSha256'), answerKeySha256: sha256(input.answerKeySha256, 'answerKeySha256'), answerKey: answerKey as Record<string, number>, questions };
}

async function main(): Promise<void> {
    const file = process.env.OFFICIAL_PYQ_FILE?.trim();
    if (!file) fail('set OFFICIAL_PYQ_FILE to a reviewed JSON import file');
    const input = parseInput(JSON.parse(await readFile(file, 'utf8')));
    const track: ExamTrack = input.program === 'UPSC_CSE' ? 'UPSC' : 'SSC';
    const subjectIds = [...new Set(input.questions.map((question) => question.subjectId))];
    const subjects = await prisma.subject.findMany({ where: { id: { in: subjectIds }, examTrack: track }, select: { id: true } });
    if (subjects.length !== subjectIds.length) fail('every question subjectId must belong to the selected UPSC/SSC track; seed subjects first');
    const existing = await prisma.pYQPaper.findFirst({ where: { paperKey: input.paperKey, examProgram: input.program, year: input.year } });
    const paper = await prisma.$transaction(async (tx) => {
        const saved = existing
            ? await tx.pYQPaper.update({ where: { id: existing.id }, data: { examTrack: track, examStage: input.stage, durationMin: input.durationMin, sourceName: input.sourceName, sourceUrl: input.sourceUrl, answerKeyUrl: input.answerKeyUrl, verificationMethod: 'OFFICIAL_FINAL_KEY_CROSS_CHECK', verifiedAt: input.reviewedAt ? new Date(input.reviewedAt) : new Date() } })
            : await tx.pYQPaper.create({ data: { examTrack: track, examProgram: input.program, examStage: input.stage, paperKey: input.paperKey, year: input.year, durationMin: input.durationMin ?? 120, answerKeyId: randomUUID(), sourceName: input.sourceName, sourceUrl: input.sourceUrl, answerKeyUrl: input.answerKeyUrl, verificationMethod: 'OFFICIAL_FINAL_KEY_CROSS_CHECK', verifiedAt: input.reviewedAt ? new Date(input.reviewedAt) : new Date() } });
        await tx.pYQ.deleteMany({ where: { paperId: saved.id } });
        await tx.answerKey.upsert({ where: { paperId: saved.id }, create: { paperId: saved.id, entries: input.answerKey as Prisma.InputJsonValue }, update: { entries: input.answerKey as Prisma.InputJsonValue } });
        await tx.pYQ.createMany({ data: input.questions.map((question, index) => ({ paperId: saved.id, examTrack: track, examProgram: input.program, examStage: input.stage, year: input.year, subjectId: question.subjectId, questionText: question.questionText, options: question.options, correctOption: input.answerKey[question.questionRef || String(index + 1)] })) });
        return saved;
    });
    console.log(JSON.stringify({ imported: true, paperId: paper.id, paperKey: input.paperKey, questions: input.questions.length, verifiedAt: new Date().toISOString() }));
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }).finally(() => void prisma.$disconnect());
