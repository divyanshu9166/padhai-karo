export interface StrategySimulationInput { questionCount: number; totalTimeSec: number; targetAttempted: number; averageReadSec?: number; reviewSec?: number; }
export interface StrategySimulation { firstPassSec: number; reviewSec: number; bufferSec: number; secondsPerQuestion: number; feasibility: 'COMFORTABLE' | 'TIGHT' | 'UNREALISTIC'; checkpoints: { question: number; elapsedSec: number }[]; advice: string[]; }

export function simulateStrategy(input: StrategySimulationInput): StrategySimulation {
    const firstPassSec = Math.max(0, input.targetAttempted) * Math.max(5, input.averageReadSec ?? 45);
    const reviewSec = Math.max(0, input.reviewSec ?? 300);
    const bufferSec = input.totalTimeSec - firstPassSec - reviewSec;
    const secondsPerQuestion = input.questionCount <= 0 ? 0 : Math.round(input.totalTimeSec / input.questionCount);
    const feasibility = bufferSec >= input.totalTimeSec * 0.15 ? 'COMFORTABLE' : bufferSec >= 0 ? 'TIGHT' : 'UNREALISTIC';
    const checkpointEvery = Math.max(1, Math.round(Math.max(1, input.questionCount) / 4));
    const checkpoints = [1, 2, 3, 4].map((quarter) => ({ question: Math.min(input.questionCount, checkpointEvery * quarter), elapsedSec: Math.round((input.totalTimeSec - reviewSec) * quarter / 4) }));
    const advice = feasibility === 'UNREALISTIC' ? ['Reduce the target attempt count or lower the first-pass reading time.', 'Leave a final review buffer.'] : feasibility === 'TIGHT' ? ['Flag uncertain questions and move on quickly.', 'Use checkpoints to protect the last review window.'] : ['Keep the review buffer protected.', 'Use the first pass for high-confidence questions.'];
    return { firstPassSec, reviewSec, bufferSec, secondsPerQuestion, feasibility, checkpoints, advice };
}
