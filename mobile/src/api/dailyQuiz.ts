/**
 * Daily Quiz endpoints: a 10-question PYQ drill that changes every India day.
 *
 *   GET  /daily-quiz          -> { quizDate, available, questions, completed, streak }
 *   POST /daily-quiz/submit   { questionIds, answers } -> 201 { result, streak }
 */
import { request } from './client';

export interface DailyQuizQuestion {
    id: string;
    questionText: string;
    options: string[];
    year: number;
    subjectId: string;
}

export interface DailyQuizReviewItem extends DailyQuizQuestion {
    selectedOption: number | null;
    correctOption: number;
    outcome: 'CORRECT' | 'INCORRECT' | 'UNANSWERED';
}

export interface DailyQuizStreak {
    current: number;
    doneToday: boolean;
}

export interface DailyQuizResponse {
    quizDate: string;
    available: boolean;
    questions: DailyQuizQuestion[];
    completed: { correctCount: number; totalCount: number; review: DailyQuizReviewItem[] } | null;
    streak: DailyQuizStreak;
}

export interface DailyQuizSubmitResponse {
    result: { quizDate: string; correctCount: number; totalCount: number; review: DailyQuizReviewItem[] };
    streak: DailyQuizStreak;
}

export function getDailyQuiz(): Promise<DailyQuizResponse> {
    return request<DailyQuizResponse>('/daily-quiz');
}

export function submitDailyQuiz(questionIds: string[], answers: Record<string, number | null>): Promise<DailyQuizSubmitResponse> {
    return request<DailyQuizSubmitResponse>('/daily-quiz/submit', { method: 'POST', body: { questionIds, answers } });
}
