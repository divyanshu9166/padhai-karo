import type { AuthContext } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { forecastNextPracticeScore } from './improvementForecast';

export async function getImprovementForecastForUser(userId: string) {
    const reviews = await prisma.externalPaperReview.findMany({
        where: { userId },
        orderBy: [{ testDate: 'desc' }, { createdAt: 'desc' }],
        take: 8,
        select: { testDate: true, obtainedScore: true, maxScore: true },
    });
    return forecastNextPracticeScore(reviews.map((review) => ({
        date: review.testDate, obtainedScore: review.obtainedScore, maxScore: review.maxScore,
    })));
}

export async function getImprovementForecastHandler(_request: Request, auth: AuthContext): Promise<Response> {
    return Response.json({ forecast: await getImprovementForecastForUser(auth.user.id) });
}
