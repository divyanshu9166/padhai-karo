import type { AuthContext } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { requireOperatorKey } from '@/lib/operatorAuth';
import { findPaperDefinition } from '@/lib/exams';

export async function officialPyqStatusHandler(request: Request, _auth: AuthContext): Promise<Response> {
    const accessError = requireOperatorKey(request);
    if (accessError) return accessError;
    const [questionCount, paperCount, papers] = await Promise.all([
        // A PYQ row without a paper is a legacy/reference row, not part of the
        // verified official corpus. Counting it here made the operator status
        // report a corpus that the paper and offline-bundle APIs could not serve.
        prisma.pYQ.count({ where: { paper: { is: { verifiedAt: { not: null }, answerKey: { isNot: null } } }, flaggedForReview: false, examTrack: { in: ['UPSC', 'SSC'] } } }),
        prisma.pYQPaper.count({ where: { examTrack: { in: ['UPSC', 'SSC'] }, verifiedAt: { not: null }, answerKey: { isNot: null } } }),
        prisma.pYQPaper.findMany({ where: { examTrack: { in: ['UPSC', 'SSC'] }, verifiedAt: { not: null }, answerKey: { isNot: null } }, orderBy: [{ year: 'desc' }, { paperKey: 'asc' }], select: { id: true, paperKey: true, examProgram: true, examStage: true, year: true, sourceName: true, sourceUrl: true, answerKeyUrl: true, verifiedAt: true, _count: { select: { questions: true } } } }),
    ]);
    const readiness = papers.map((paper) => {
        const definition = paper.examProgram && paper.examStage
            ? findPaperDefinition(paper.examProgram, paper.examStage, paper.paperKey)
            : undefined;
        const mockEligible = definition?.questionFormat === 'MCQ' && typeof definition.questionCount === 'number';
        const expectedQuestionCount = mockEligible ? definition?.questionCount ?? null : null;
        const importedQuestionCount = paper._count.questions;
        return { ...paper, importedQuestionCount, expectedQuestionCount, mockEligible, complete: mockEligible && importedQuestionCount >= (expectedQuestionCount ?? Number.POSITIVE_INFINITY) };
    });
    return Response.json({ eligible: questionCount > 0, readyForFullMock: readiness.some((paper) => paper.complete), questionCount, paperCount, papers: readiness, generatedAt: new Date().toISOString() });
}
