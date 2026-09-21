export interface ForecastPoint {
    date: Date;
    obtainedScore: number;
    maxScore: number;
}

export type ImprovementForecast =
    | {
        kind: 'INSUFFICIENT_DATA';
        minimumRequired: 3;
        available: number;
        message: string;
    }
    | {
        kind: 'ESTIMATE';
        confidence: 'LOW' | 'MEDIUM' | 'HIGH';
        sampleSize: number;
        currentPercent: number;
        estimatedNextPercent: { low: number; high: number };
        estimatedNextMarks: { low: number; high: number; maximum: number };
        trendPointsPerAttempt: number;
        assumptions: string[];
        message: string;
        disclaimer: string;
    };

function round1(value: number): number { return Math.round(value * 10) / 10; }
function clamp(value: number, low: number, high: number): number { return Math.max(low, Math.min(high, value)); }

/**
 * Estimates a deliberately wide next-practice range from comparable self-reported papers.
 * It never estimates rank or selection and never returns a single guaranteed score.
 */
export function forecastNextPracticeScore(input: readonly ForecastPoint[]): ImprovementForecast {
    const points = input
        .filter((point) => Number.isFinite(point.obtainedScore) && Number.isFinite(point.maxScore) && point.maxScore > 0 && point.obtainedScore >= 0 && point.obtainedScore <= point.maxScore)
        .map((point) => ({ ...point, percent: point.obtainedScore / point.maxScore * 100 }))
        .sort((a, b) => a.date.getTime() - b.date.getTime())
        .slice(-8);

    if (points.length < 3) {
        return {
            kind: 'INSUFFICIENT_DATA', minimumRequired: 3, available: points.length,
            message: `Add ${3 - points.length} more comparable paper${3 - points.length === 1 ? '' : 's'} before showing an improvement range.`,
        };
    }

    const n = points.length;
    const meanX = (n - 1) / 2;
    const meanY = points.reduce((sum, point) => sum + point.percent, 0) / n;
    const denominator = points.reduce((sum, _point, index) => sum + (index - meanX) ** 2, 0);
    const rawSlope = denominator === 0 ? 0 : points.reduce((sum, point, index) => sum + (index - meanX) * (point.percent - meanY), 0) / denominator;
    const slope = clamp(rawSlope, -5, 5);
    const recent = points.slice(-3);
    const recentMean = recent.reduce((sum, point) => sum + point.percent, 0) / recent.length;
    const projected = clamp(recentMean + slope * 0.75, 0, 100);
    const residualSd = Math.sqrt(points.reduce((sum, point, index) => {
        const fitted = meanY + rawSlope * (index - meanX);
        return sum + (point.percent - fitted) ** 2;
    }, 0) / Math.max(1, n - 1));
    const halfWidth = clamp(Math.max(4, residualSd * 1.35, 11 / Math.sqrt(n)), 4, 18);
    const lowPercent = round1(clamp(projected - halfWidth, 0, 100));
    const highPercent = round1(clamp(projected + halfWidth, 0, 100));
    const latest = points[n - 1];
    const confidence: 'LOW' | 'MEDIUM' | 'HIGH' = n >= 6 && residualSd <= 7 ? 'HIGH' : n >= 4 && residualSd <= 12 ? 'MEDIUM' : 'LOW';

    return {
        kind: 'ESTIMATE', confidence, sampleSize: n, currentPercent: round1(latest.percent),
        estimatedNextPercent: { low: lowPercent, high: highPercent },
        estimatedNextMarks: {
            low: round1(lowPercent / 100 * latest.maxScore),
            high: round1(highPercent / 100 * latest.maxScore),
            maximum: latest.maxScore,
        },
        trendPointsPerAttempt: round1(slope),
        assumptions: [
            'The papers are comparable in syllabus coverage, difficulty and exam conditions.',
            'You complete most of the recommended weak-area practice before the next attempt.',
            'Sleep, timing and test-day conditions stay broadly similar.',
        ],
        message: slope >= 0
            ? 'Your recent practice trend is moving in the right direction. Use the range as a planning signal, not a promise.'
            : 'This dip is useful feedback, not a verdict. Stabilise the weakest section before adding more study hours.',
        disclaimer: 'This is an evidence-based practice estimate, not a guaranteed score, rank, selection probability or exam outcome.',
    };
}
