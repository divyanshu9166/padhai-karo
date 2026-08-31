import { Prisma } from '@prisma/client';
import type { AuthContext } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { ErrorCode, errorResponse } from '@/lib/errors';

function feedbackFor(answerText: string, wordCount: number): { score: number; strengths: string[]; nextSteps: string[] } {
    const hasStructure = /\b(introduction|conclusion|way forward|challenges|measures|impact|कारण|निष्कर्ष)\b/i.test(answerText);
    const hasExamples = /\b(example|case|data|report|article|उदाहरण|आंकड़े)\b/i.test(answerText);
    const lengthScore = wordCount >= 120 && wordCount <= 260 ? 30 : wordCount < 120 ? 18 : 22;
    const score = Math.min(100, lengthScore + (hasStructure ? 35 : 20) + (hasExamples ? 25 : 15));
    return {
        score,
        strengths: [hasStructure ? 'The answer has visible structure.' : 'The answer is focused and can be structured further.', hasExamples ? 'Examples or evidence are present.' : 'The core argument is clear.'],
        nextSteps: [hasStructure ? 'Make each paragraph answer one dimension.' : 'Add a brief introduction, 2-3 subheadings and a conclusion.', hasExamples ? 'Connect each example directly to the argument.' : 'Add one relevant example, committee, report or current-affairs reference.'],
    };
}

export async function createAnswerWritingHandler(request: Request, auth: AuthContext): Promise<Response> {
    let body: unknown;
    try { body = await request.json(); } catch { body = null; }
    if (!body || typeof body !== 'object') return errorResponse(422, ErrorCode.VALIDATION_ERROR, 'Request body must be an object.');
    const input = body as Record<string, unknown>;
    const prompt = typeof input.prompt === 'string' ? input.prompt.trim() : '';
    const answerText = typeof input.answerText === 'string' ? input.answerText.trim() : '';
    const wordCount = typeof input.wordCount === 'number' && Number.isInteger(input.wordCount) ? input.wordCount : answerText.split(/\s+/).filter(Boolean).length;
    if (!prompt || !answerText || wordCount < 1 || wordCount > 5000) return errorResponse(422, ErrorCode.VALIDATION_ERROR, 'prompt and answerText are required.');
    const feedback = feedbackFor(answerText, wordCount);
    const attempt = await prisma.answerWritingAttempt.create({
        data: {
            userId: auth.user.id,
            subjectId: typeof input.subjectId === 'string' ? input.subjectId : undefined,
            prompt, answerText, wordCount,
            timeTakenSec: typeof input.timeTakenSec === 'number' ? input.timeTakenSec : undefined,
            selfScore: feedback.score,
            feedback: feedback as unknown as Prisma.InputJsonValue,
            status: 'REVIEWED', submittedAt: new Date(),
        },
    });
    return Response.json({ attempt }, { status: 201 });
}

export async function listAnswerWritingHandler(request: Request, auth: AuthContext): Promise<Response> {
    const limit = Math.min(50, Math.max(1, Number(new URL(request.url).searchParams.get('limit') ?? 20) || 20));
    const attempts = await prisma.answerWritingAttempt.findMany({ where: { userId: auth.user.id }, orderBy: { createdAt: 'desc' }, take: limit });
    return Response.json({ attempts });
}
