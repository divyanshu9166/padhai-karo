import { request } from '@/api';

export type TaskType = 'READING' | 'NOTES_MAKING' | 'REVISION' | 'PYQ_PRACTICE' | 'ANSWER_WRITING' | 'MOCK_TEST' | 'MOCK_ANALYSIS' | 'CURRENT_AFFAIRS' | 'QUANT_PRACTICE' | 'REASONING_PRACTICE' | 'VOCABULARY' | 'FORMULA_REVISION';
export type TaskPriority = 'LOW' | 'NORMAL' | 'HIGH' | 'CRITICAL';
export type TaskStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'MISSED';

export interface StudyTask {
    id: string;
    title: string;
    syllabusUnit: string | null;
    subjectId: string | null;
    taskType: TaskType;
    plannedMinutes: number;
    scheduledDate: string | null;
    priority: TaskPriority;
    status: TaskStatus;
    source: string;
}

export interface TodayResponse {
    profile: { examProgram: 'UPSC_CSE' | 'SSC_CGL' | null; examStage: 'PRELIMS' | 'MAINS' | 'TIER_1' | 'TIER_2' | null } | null;
    countdownDays: number | null;
    tasks: StudyTask[];
    progress: { completed: number; total: number; focusedMinutes: number };
    revisionDue: number;
    currentAffairs: { id: string; title: string; category: string; syllabusTags: string[]; prelimsRelevance: string | null; mainsRelevance: string | null } | null;
    backlogCount: number;
}

export function getToday(): Promise<TodayResponse> {
    return request<TodayResponse>('/today');
}

export function updateStudyTask(id: string, patch: Partial<Pick<StudyTask, 'title' | 'plannedMinutes' | 'scheduledDate' | 'priority' | 'status'>>): Promise<{ task: StudyTask }> {
    return request<{ task: StudyTask }>(`/study-tasks/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch });
}

export function listStudyTasks(input: { from?: string; to?: string; includeInbox?: boolean } = {}): Promise<{ tasks: StudyTask[] }> {
    const params = new URLSearchParams();
    if (input.from) params.set('from', input.from);
    if (input.to) params.set('to', input.to);
    if (input.includeInbox) params.set('includeInbox', 'true');
    const query = params.toString();
    return request<{ tasks: StudyTask[] }>(`/study-tasks${query ? `?${query}` : ''}`);
}

export function quickCapture(title: string): Promise<{ task: StudyTask }> {
    return request<{ task: StudyTask }>('/study-tasks', { method: 'POST', body: { title, plannedMinutes: 20, quickCapture: true } });
}

export function rescueBacklog(input: { days?: 3 | 7; mode?: 'REDUCE_WORKLOAD' }): Promise<{ rescued: number; movedToInbox: number; days: number; dailyMinutes: number }> {
    return request('/study-tasks/backlog-rescue', { method: 'POST', body: input });
}

export function getWeeklyReview(): Promise<{
    focusedMinutes: number; consistencyDays: number; plan: { completed: number; total: number; missed: number; completionPercent: number };
    revisionCompleted: number; practice: { questions: number; accuracyPercent: number | null }; biggestWeakness: string | null;
}> {
    return request('/reviews/weekly');
}
