import type { NegativeMarking } from '@/lib/exams/types';

export interface MockScoringQuestion {
    id: string;
    correctOption: number;
}

export interface MockScoreResult {
    correctCount: number;
    incorrectCount: number;
    unansweredCount: number;
    obtainedScore: number;
    maximumScore: number;
    negativeMarks: number;
}

export function scoreMockQuestions(
    questions: ReadonlyArray<MockScoringQuestion>,
    answers: Readonly<Record<string, unknown>>,
    marksPerQuestion: number,
    negativeMarking: NegativeMarking,
): MockScoreResult {
    const marks = Number.isFinite(marksPerQuestion) && marksPerQuestion > 0 ? marksPerQuestion : 1;
    let correctCount = 0;
    let incorrectCount = 0;
    let unansweredCount = 0;
    for (const question of questions) {
        const selected = answers[question.id];
        if (selected === null || selected === undefined || selected === '') {
            unansweredCount += 1;
        } else if (Number.isInteger(selected) && Number(selected) === question.correctOption) {
            correctCount += 1;
        } else {
            incorrectCount += 1;
        }
    }
    const negativePerQuestion = negativeMarking.kind === 'FIXED_MARKS'
        ? negativeMarking.marks
        : negativeMarking.kind === 'FRACTION_OF_QUESTION_MARKS'
            ? marks * negativeMarking.fraction
            : 0;
    const negativeMarks = incorrectCount * negativePerQuestion;
    return {
        correctCount,
        incorrectCount,
        unansweredCount,
        obtainedScore: Math.round((correctCount * marks - negativeMarks) * 100) / 100,
        maximumScore: questions.length * marks,
        negativeMarks: Math.round(negativeMarks * 100) / 100,
    };
}
