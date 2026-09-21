import { Prisma } from '@prisma/client';
import type { AuthContext } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { ErrorCode, errorResponse } from '@/lib/errors';
import { evaluateAnswerWithProvider, liveProviderConfigured } from '@/services/ai/liveProvider';

const STOP_WORDS = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'what', 'how', 'why', 'discuss', 'examine', 'analyse', 'analyze', 'evaluate']);
function feedbackFor(prompt: string, answerText: string, wordCount: number) {
    const promptTerms = [...new Set(prompt.toLowerCase().match(/[a-z]{4,}/g) ?? [])].filter((term) => !STOP_WORDS.has(term));
    const answerLower = answerText.toLowerCase();
    const matched = promptTerms.filter((term) => answerLower.includes(term)).length;
    const relevance = Math.round(20 * (promptTerms.length === 0 ? 0.6 : Math.min(1, matched / Math.min(4, promptTerms.length))));
    const paragraphCount = answerText.split(/\n\s*\n|\n(?=[A-Z0-9])/).filter((part) => part.trim().length > 20).length;
    const hasOpening = /\b(introduction|means|refers to|context|भूमिका|परिचय)\b/i.test(answerText);
    const hasConclusion = /\b(conclusion|way forward|therefore|thus|निष्कर्ष|आगे की राह)\b/i.test(answerText);
    const structure = Math.min(20, 6 + (paragraphCount >= 3 ? 6 : paragraphCount * 2) + (hasOpening ? 4 : 0) + (hasConclusion ? 4 : 0));
    const evidenceSignals = answerText.match(/\b(article\s+\d+|committee|commission|report|survey|case study|example|data|\d+(?:\.\d+)?%|उदाहरण|आंकड़े|अनुच्छेद\s+\d+)\b/gi)?.length ?? 0;
    const evidence = Math.min(20, 6 + evidenceSignals * 3);
    const analysisSignals = answerText.match(/\b(however|because|therefore|impact|challenge|limitation|measure|stakeholder|on the other hand|कारण|प्रभाव|चुनौती|उपाय)\b/gi)?.length ?? 0;
    const analysis = Math.min(20, 6 + analysisSignals * 2);
    const targetWords = /\b(10\s*marks?|150\s*words?)\b/i.test(prompt) ? 150 : /\b(15\s*marks?|250\s*words?)\b/i.test(prompt) ? 250 : 200;
    const deviation = Math.abs(wordCount - targetWords) / targetWords;
    const clarity = Math.max(5, Math.round(20 - Math.min(12, deviation * 16) - (answerText.split(/[.!?।]+/).some((sentence) => sentence.trim().split(/\s+/).length > 45) ? 3 : 0)));
    const score = relevance + structure + evidence + analysis + clarity;
    const strengths = [relevance >= 14 ? 'The response addresses the main demand.' : 'The answer has a usable starting argument.', structure >= 14 ? 'The answer is organised into a readable progression.' : 'The response stays focused enough to restructure quickly.', evidence >= 14 ? 'Concrete constitutional, data or example-based support is present.' : 'The central position is visible.'];
    const nextSteps = [relevance < 14 ? 'Underline the directive and repeat its key terms in the introduction and conclusion.' : 'Make every paragraph answer one dimension of the directive.', structure < 14 ? 'Use a 2-line introduction, 3-5 labelled dimensions and a 2-line way forward.' : 'Strengthen transitions between dimensions.', evidence < 14 ? 'Add one precise article, committee, report, case, example or statistic.' : 'Explain how each example proves the argument.', analysis < 14 ? 'Add cause, impact, limitation and practical way-forward links.' : 'Add one counterpoint or implementation constraint.'];
    return {
        score, criteria: { relevance, structure, evidence, analysis, clarity }, strengths, nextSteps,
        demandAnalysis: promptTerms.length ? `The answer should directly cover: ${promptTerms.slice(0, 5).join(', ')}.` : 'Identify the directive and required dimensions before writing.',
        factualCautions: ['Automated fallback review cannot verify factual accuracy; cross-check names, dates, articles and statistics against a trusted source.'],
        source: 'RUBRIC' as const,
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
    let feedback: {
        score: number; criteria: Record<string, number>; strengths: string[]; nextSteps: string[];
        demandAnalysis: string; factualCautions: string[]; source: 'RUBRIC' | 'AI';
    } = feedbackFor(prompt, answerText, wordCount);
    if (liveProviderConfigured()) {
        try { feedback = { ...(await evaluateAnswerWithProvider({ prompt, answerText, wordCount })), source: 'AI' }; }
        catch { /* preserve deterministic rubric feedback */ }
    }
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
