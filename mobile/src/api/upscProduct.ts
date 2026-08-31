import { ApiError, request, requestText, uploadMultipart } from '@/api';
import { queueMutation } from '@/offline/mutations';

export interface PlanningOverview {
    selectedDate: string;
    exam: { program: string | null; stage: string | null; nearest: string | null; countdownDays: number | null; phase: string; dates: { id: string; label: string; examDate: string; priority: number }[] };
    time: { timeDebtMin: number; studyCreditMin: number; averageEfficiencyPercent: number; recommendedDailyMin: number };
    priorities: { id: string; name: string; subjectId: string; reason: string; score: number }[];
    schedule: { blocks: { id: string; subjectId: string | null; chapterId: string | null; startTime: string; durationMin: number; isBuffer: boolean; energyLevel: string; sessionType: string; revisionNumber: number | null; revisionLabel?: string | null }[]; sleepSchedule: { bedtime: string; wakeTime: string; windDownMin: number } | null };
    wellbeing: { mood: number; energy: number; stress: number; sleepHours: number | null; score: number } | null;
    revision?: { dueCount: number; cycleIntervalsDays: number[]; nextCards: RevisionCard[] };
}

export interface DailyBriefing { phase: string; countdownDays: number | null; priorities: unknown; schedule: unknown; insights: { greeting: string; actions: string[]; weakAreas: unknown[]; updates: unknown[]; wellbeing: unknown; source?: 'AI' | 'RULE_BASED'; ai?: { title?: string; keyPoints?: string[] } | null } }
export interface PracticeInsights { summary: { totalAttempts: number; correct: number; incorrect: number; unanswered: number; accuracyPercent: number; averageTimedSeconds: number | null }; weakAreas: unknown[]; strategy: string[]; }
export interface CurrentAffairsItem { id: string; title: string; summary: string; category: string; sourceName: string; sourceUrl: string; publishedAt: string; tags: string[]; bookmark: { id: string; read: boolean; notes: string | null } | null }

export function getPlanningOverview(date?: string): Promise<PlanningOverview> {
    return request<PlanningOverview>(`/planning/overview${date ? `?date=${encodeURIComponent(date)}` : ''}`);
}
export function createExamDate(input: { label: string; examDate: string; priority?: number; examProgram?: string; examStage?: string }): Promise<{ date: PlanningOverview['exam']['dates'][number] }> { return request('/planning/exam-dates', { method: 'POST', body: input }); }
export function getDailyBriefing(): Promise<{ briefing: DailyBriefing }> { return request('/briefing/daily'); }
export function refreshDailyBriefing(): Promise<{ briefing: DailyBriefing }> { return request('/briefing/daily', { method: 'POST' }); }
export function getPracticeInsights(): Promise<PracticeInsights> { return request('/practice/insights'); }
export function getAnalyticsDashboard(rangeDays?: number): Promise<{ weakAreas?: unknown[]; sessionTypeDistribution?: unknown; topics?: unknown[]; points?: unknown[]; benchmark?: unknown; rankPrediction?: unknown; errors: string[] }> {
    const from = typeof rangeDays === 'number' && rangeDays > 0
        ? new Date(Date.now() - Math.floor(rangeDays) * 86_400_000).toISOString()
        : null;
    const scoreTrajectoryUrl = from ? `/analytics/score-trajectory?from=${encodeURIComponent(from)}` : '/analytics/score-trajectory';
    return Promise.allSettled([
        request<{ weakAreas?: unknown[]; sessionTypeDistribution?: unknown }>('/analytics/weak-areas'),
        request<{ topics?: unknown[] }>('/analytics/topic-trends'),
        request<{ points?: unknown[] }>(scoreTrajectoryUrl),
        request<unknown>('/analytics/rank-prediction'),
        request<{ benchmark?: unknown }>('/analytics/benchmark'),
    ]).then((results) => ({
        weakAreas: results[0].status === 'fulfilled' ? results[0].value.weakAreas : [],
        sessionTypeDistribution: results[0].status === 'fulfilled' ? results[0].value.sessionTypeDistribution : null,
        topics: results[1].status === 'fulfilled' ? results[1].value.topics : [],
        points: results[2].status === 'fulfilled' ? results[2].value.points : [],
        rankPrediction: results[3].status === 'fulfilled' ? results[3].value : null,
        benchmark: results[4].status === 'fulfilled' ? results[4].value.benchmark : null,
        errors: results.map((result, index) => result.status === 'rejected' ? `Analytics section ${index + 1} could not load.` : '').filter(Boolean),
    }));
}
export function submitAnswerWriting(input: { prompt: string; answerText: string; subjectId?: string; timeTakenSec?: number }): Promise<{ attempt: unknown }> { return request('/answer-writing', { method: 'POST', body: input }); }
export function saveWellbeing(input: { checkinDate?: string; mood: number; energy: number; stress: number; sleepHours?: number; note?: string }): Promise<{ checkin: unknown }> { return request('/wellbeing/checkins', { method: 'POST', body: input }); }
export function saveSleepSchedule(input: { bedtime: string; wakeTime: string; windDownMin?: number }): Promise<{ schedule: unknown }> { return request('/wellbeing/sleep-schedule', { method: 'PUT', body: input }); }
export function getCurrentAffairs(): Promise<{ items: CurrentAffairsItem[] }> { return request('/current-affairs'); }
export function bookmarkCurrentAffairs(itemId: string, read = true): Promise<{ bookmark: unknown }> { return request('/current-affairs', { method: 'POST', body: { itemId, read } }); }
export function createOpenNote(input: { inputType: 'TEXT' | 'PHOTO' | 'VOICE'; text: string; title?: string }): Promise<{ summary: unknown }> { return request('/ai/notes', { method: 'POST', body: input }); }
export function getResources(): Promise<{ resources: unknown[] }> { return request('/resources'); }
export function createResource(input: { title: string; url?: string; type?: string; tags?: string[] }): Promise<{ resource: unknown }> { return request('/resources', { method: 'POST', body: input }); }
export function updateResource(id: string, input: { title?: string; url?: string | null; tags?: string[]; completed?: boolean }): Promise<{ resource: unknown }> { return request('/resources/' + encodeURIComponent(id), { method: 'PATCH', body: input }); }
export function deleteResource(id: string): Promise<void> { return request('/resources/' + encodeURIComponent(id), { method: 'DELETE' }); }
export function getCommunityPosts(): Promise<{ posts: unknown[] }> { return request('/community/posts'); }
export function createCommunityPost(input: { title: string; body: string; tags?: string[]; anonymous?: boolean }): Promise<{ post: unknown }> { return request('/community/posts', { method: 'POST', body: input }); }
export function reportCommunityContent(input: { postId?: string; messageId?: string; reason: string }): Promise<{ report: unknown }> { return request('/community/reports', { method: 'POST', body: input }); }
export function getBuddyMatches(): Promise<{ matches: BuddyMatch[] }> { return request('/community/matches'); }
export function getBuddies(): Promise<{ sent: BuddyRequest[]; received: BuddyRequest[] }> { return request('/community/buddies'); }
export function requestBuddy(recipientId: string): Promise<{ buddy: BuddyRequest }> { return request('/community/buddies', { method: 'POST', body: { recipientId } }); }
export function updateBuddy(id: string, status: 'ACCEPTED' | 'DECLINED' | 'BLOCKED'): Promise<{ buddy: BuddyRequest }> { return request('/community/buddies/' + encodeURIComponent(id), { method: 'PATCH', body: { status } }); }
export function getCommunityMessages(userId: string, since?: string): Promise<{ messages: CommunityMessage[] }> { return request('/community/messages?with=' + encodeURIComponent(userId) + (since ? '&since=' + encodeURIComponent(since) : '')); }
export function sendCommunityMessage(recipientId: string, body: string): Promise<{ message: CommunityMessage }> { return request('/community/messages', { method: 'POST', body: { recipientId, body } }); }
export function shareDashboard(recipientId: string, enabled = true): Promise<unknown> { return request('/community/dashboard/share', { method: 'POST', body: { recipientId, enabled } }); }
export function getSharedDashboard(userId: string): Promise<{ dashboard: SharedDashboard }> { return request('/community/dashboard/' + encodeURIComponent(userId)); }
export function getRevisionCards(dueOnly = true): Promise<{ cards: RevisionCard[]; dueCount: number }> { return request('/revision/cards?dueOnly=' + String(dueOnly)); }
export function reviewRevisionCard(id: string, rating: 1 | 2 | 3 | 4): Promise<{ card: RevisionCard; nextReviewAt: string }> { return request('/revision/cards/' + encodeURIComponent(id) + '/review', { method: 'POST', body: { rating } }); }
export function createRecallDrillAttempt(input: { sourceType: string; itemCount: number; durationSec: number; correct: number; revealed: number }): Promise<{ attempt: unknown; accuracyPercent: number }> { return request('/learning/recall-drills', { method: 'POST', body: input }); }
export function createRevisionCard(input: { title: string; prompt: string; answer: string; chapterId?: string; tags?: string[] }): Promise<{ card: RevisionCard }> { return request('/revision/cards', { method: 'POST', body: input }); }
export function getRevisionSchedule(): Promise<{ cards: RevisionCard[]; byDate: Record<string, number>; sequences: RevisionSequence[] }> { return request('/revision/schedule'); }
export function createFormula(input: { title: string; expression: string; explanation?: string; tags?: string[] }): Promise<{ item: FormulaItem }> { return request('/formulas', { method: 'POST', body: input }); }
export function getFormulas(): Promise<{ items: FormulaItem[] }> { return request('/formulas'); }
export function createConceptMap(input: { title: string; nodes: unknown[]; edges: unknown[] }): Promise<{ map: ConceptMap }> { return request('/concept-maps', { method: 'POST', body: input }); }
export function getConceptMaps(): Promise<{ maps: ConceptMap[] }> { return request('/concept-maps'); }
export function createCapsule(input: { title: string; points: string[]; chapterId?: string }): Promise<{ capsule: unknown }> { return request('/revision-capsules', { method: 'POST', body: input }); }
export function getWellbeingInsights(): Promise<WellbeingInsights> { return request('/wellbeing/insights'); }
export function createRecoveryPlan(reason?: string): Promise<{ plan: unknown }> { return request('/wellbeing/recovery', { method: 'POST', body: { reason } }); }
export function logAnxietyProtocol(protocol: string, durationSec: number): Promise<{ log: unknown; steps: string[] }> { return request('/wellbeing/protocol', { method: 'POST', body: { protocol, durationSec } }); }
export function getMilestones(): Promise<{ milestones: Milestone[] }> { return request('/milestones'); }
export function getExamChecklist(): Promise<{ items: ChecklistItem[] }> { return request('/exam-checklist'); }
export function updateExamChecklist(id: string, completed: boolean): Promise<{ item: ChecklistItem }> { return request('/exam-checklist/' + encodeURIComponent(id), { method: 'PATCH', body: { completed } }); }
export function getStrategies(): Promise<{ strategies: StrategyItem[] }> { return request('/strategies'); }
export function getDoubts(status?: string): Promise<{ doubts: DoubtItem[] }> { return request('/doubts' + (status ? '?status=' + encodeURIComponent(status) : '')); }
export function exportDoubtsCsv(): Promise<string> { return requestText('/doubts?format=csv'); }
export function createDoubt(input: { title: string; question: string; tags?: string[]; resourceUrls?: string[] }): Promise<{ doubt: DoubtItem }> { return request('/doubts', { method: 'POST', body: input }); }
export function updateDoubt(id: string, input: { status?: string; tags?: string[]; resourceUrls?: string[] }): Promise<{ doubt: DoubtItem }> { return request('/doubts/' + encodeURIComponent(id), { method: 'PATCH', body: input }); }
export function getCounselling(): Promise<Counselling> { return request('/guidance/counselling'); }
export function connectCoaching(provider: string, externalId = 'default'): Promise<{ connection: unknown }> { return request('/coaching/connections', { method: 'POST', body: { provider, externalId } }); }
export function syncCoaching(provider: string, externalId = 'default'): Promise<{ connection: unknown; imported: number }> { return request('/coaching/sync', { method: 'POST', body: { provider, externalId } }); }
export function predictRoleFit(input: { scorePercent?: number; interests?: string[] }): Promise<{ predictions: unknown[]; disclaimer: string }> { return request('/guidance/counselling', { method: 'POST', body: input }); }
export function startMock(input?: { title?: string; durationSec?: number }): Promise<{ attempt: MockAttempt; questions: MockQuestion[]; scoring?: MockScoring }> { return request('/practice/mock', { method: 'POST', body: input ?? {} }); }
export function saveMock(id: string, input: { answers: Record<string, number | null>; markedForReview: string[]; currentQuestion: number }): Promise<{ attempt: MockAttempt }> { return request('/practice/mock/' + encodeURIComponent(id), { method: 'PATCH', body: input }); }
export function submitMock(id: string, answers?: Record<string, number | null>): Promise<{ attempt: MockAttempt; scorePercent: number; score?: MockScore }> { return request('/practice/mock/' + encodeURIComponent(id), { method: 'POST', body: answers ? { answers } : {} }); }
export function createExternalPaperReview(input: ExternalPaperReviewInput): Promise<{ review: ExternalPaperReview }> { return request('/practice/external-paper-reviews', { method: 'POST', body: input }); }
export function getExternalPaperReviews(): Promise<{ reviews: ExternalPaperReview[] }> { return request('/practice/external-paper-reviews'); }
export function deleteExternalPaperReview(id: string): Promise<void> { return request('/practice/external-paper-reviews/' + encodeURIComponent(id), { method: 'DELETE' }); }
export function savePacing(input: { questionCount: number; targetSeconds: number; actualSeconds: number; correct: number; skipped: number }): Promise<{ attempt: unknown }> { return request('/practice/pacing', { method: 'POST', body: input }); }
export function simulateStrategy(input: { questionCount: number; totalTimeSec: number; targetAttempted: number; averageReadSec?: number; reviewSec?: number }): Promise<{ simulation: { firstPassSec: number; reviewSec: number; bufferSec: number; secondsPerQuestion: number; feasibility: string; checkpoints: { question: number; elapsedSec: number }[]; advice: string[] } }> { return request('/practice/simulator', { method: 'POST', body: input }); }
export function registerPushDevice(expoPushToken: string, platform: string): Promise<unknown> { return request('/notifications/devices', { method: 'POST', body: { expoPushToken, platform } }); }
export function refreshCurrentAffairs(): Promise<unknown> { return request('/current-affairs/refresh', { method: 'POST' }); }
export function getGoogleCalendarConnectUrl(): Promise<{ authorizationUrl: string }> { return request('/calendar/google/connect'); }
export function importGoogleCalendar(): Promise<{ imported: number }> { return request('/calendar/google/import', { method: 'POST' }); }
export function getGoogleCalendarStatus(): Promise<{ connected: boolean; connection: { provider: string; status: string; lastImportedAt: string | null; externalCalendarId: string | null } | null }> { return request('/calendar/google/status'); }
export function disconnectGoogleCalendar(): Promise<void> { return request('/calendar/google/disconnect', { method: 'DELETE' }); }
export function getPdfDocuments(query?: string): Promise<{ documents: PdfDocument[] }> { return request('/pdf-documents' + (query ? '?q=' + encodeURIComponent(query) : '')); }
export function createPdfDocument(input: { title: string; fileUrl?: string; pageCount?: number; tags?: string[] }): Promise<{ document: PdfDocument }> { return request('/pdf-documents', { method: 'POST', body: input }); }
export function uploadPdfDocument(uri: string, name: string, tags: string[] = []): Promise<{ document: PdfDocument; extractedText: string | null; searchable: boolean; pages?: number }> { return uploadMultipart('/pdf-documents/upload', { uri, name, type: 'application/pdf' }, { title: name.replace(/\.pdf$/i, ''), tags: tags.join(',') }); }
export function getPdfPageImageUrl(documentId: string, page: number, scale = 1.5): string { return `/api/pdf-documents/${encodeURIComponent(documentId)}/pages/${page}?scale=${encodeURIComponent(String(scale))}`; }
export function uploadVoiceNote(uri: string, name: string, durationSec?: number, tags: string[] = []): Promise<{ note: VoiceNote; transcription: string | null; transcriptionAvailable: boolean }> { return uploadMultipart('/voice-notes/upload', { uri, name, type: 'audio/mp4' }, { title: name.replace(/\.[^.]+$/, ''), ...(durationSec ? { durationSec: String(durationSec) } : {}), tags: tags.join(',') }); }
export function transcribeVoiceNote(id: string): Promise<{ note: VoiceNote }> { return request('/voice-notes/' + encodeURIComponent(id) + '/transcribe', { method: 'POST' }); }
export function getPdfAnnotations(documentId: string): Promise<{ annotations: PdfAnnotation[] }> { return request('/pdf-documents/annotations?documentId=' + encodeURIComponent(documentId)); }
export async function createPdfAnnotation(input: { documentId: string; page: number; type?: string; quote?: string; note?: string; selectionStart?: number; selectionEnd?: number; rect?: { x: number; y: number; width: number; height: number } }): Promise<{ annotation: PdfAnnotation }> {
    try { return await request('/pdf-documents/annotations', { method: 'POST', body: input }); }
    catch (error) {
        if (!(error instanceof ApiError) || error.status !== 0) throw error;
        const id = 'offline-annotation-' + Date.now(); await queueMutation('PDF_ANNOTATION_CREATE', { ...input, id });
        return { annotation: { id, documentId: input.documentId, page: input.page, type: input.type ?? 'HIGHLIGHT', quote: input.quote ?? null, note: input.note ?? null, color: '#facc15', selectionStart: input.selectionStart ?? null, selectionEnd: input.selectionEnd ?? null } };
    }
}
export async function updatePdfAnnotation(id: string, input: Partial<{ page: number; type: string; quote: string | null; note: string | null; color: string; selectionStart: number | null; selectionEnd: number | null; rect: { x: number; y: number; width: number; height: number } | null; baseUpdatedAt: string }>): Promise<{ annotation: PdfAnnotation }> {
    try { return await request('/pdf-documents/annotations/' + encodeURIComponent(id), { method: 'PATCH', body: input }); }
    catch (error) {
        if (!(error instanceof ApiError) || error.status !== 0) throw error;
        await queueMutation('PDF_ANNOTATION_UPDATE', { id, ...input });
        return { annotation: { id, documentId: '', page: input.page ?? 1, type: input.type ?? 'HIGHLIGHT', quote: input.quote ?? null, note: input.note ?? null, color: input.color ?? '#facc15', selectionStart: input.selectionStart ?? null, selectionEnd: input.selectionEnd ?? null, rect: input.rect ?? null } };
    }
}
export async function deletePdfAnnotation(id: string, baseUpdatedAt?: string): Promise<void> {
    if (id.startsWith('offline-annotation-')) { await queueMutation('PDF_ANNOTATION_DELETE', { id, ...(baseUpdatedAt ? { baseUpdatedAt } : {}) }); return; }
    try { await request('/pdf-documents/annotations/' + encodeURIComponent(id), { method: 'DELETE' }); }
    catch (error) { if (!(error instanceof ApiError) || error.status !== 0) throw error; await queueMutation('PDF_ANNOTATION_DELETE', { id, ...(baseUpdatedAt ? { baseUpdatedAt } : {}) }); }
}
export function getStudyResources(): Promise<{ resources: unknown[] }> { return request('/resources'); }
export function getAmbientModes(): Promise<{ modes: AmbientMode[] }> { return request('/focus/ambient'); }
export function getWidgetSummary(): Promise<{ widget: { todayMinutes: number; pendingTopics: number } }> { return request('/widget/summary'); }

export interface RevisionCard { id: string; title: string; prompt: string; answer: string; chapterId?: string | null; dueAt: string; intervalDays: number; repetitions: number; revisionPhase?: string | null; tags: string[]; }
export interface RevisionSequence { chapterId: string; chapterName: string; phases: { phase: string; label: string; dueAt: string | null; cardId: string | null }[]; }
export interface FormulaItem { id: string; title: string; expression: string; explanation: string | null; tags: string[]; }
export interface ConceptMap { id: string; title: string; nodes: unknown; edges: unknown; }
export interface WellbeingInsights { risk: 'LOW' | 'WATCH' | 'HIGH'; signals: { averageStress: number; averageEnergy: number; heavyStudyDays: number; missedPlanDays: number; abandonedSessions?: number }; recoveryPlan: unknown[] | null; }
export interface Milestone { id: string; label: string; targetValue: number; currentValue: number; achievedAt: string | null; }
export interface ChecklistItem { id: string; label: string; category: string; completed: boolean; dueAt?: string | null; }
export interface StrategyItem { id: string; title: string; body: string; tags: string[]; }
export interface DoubtItem { id: string; title: string; question: string; tags: string[]; resourceUrls: string[]; status: string; }
export interface BuddyMatch { userId: string; examProgram: string | null; examStage: string | null; matchScore: number; reason: string; }
export interface BuddyRequest { id: string; requesterId?: string; recipientId?: string; status: string; createdAt: string; }
export interface CommunityMessage { id: string; senderId: string; recipientId: string; body: string; readAt: string | null; createdAt: string; }
export interface CommunityPost { id: string; title: string; body: string; tags: string[]; anonymous: boolean; authorLabel: string; createdAt: string; }
export interface SharedDashboard { focusMinutes: number; focusSessions: number; audits: { date: string; plannedMin: number; actualMin: number }[]; upcomingBlocks: { startTime: string; durationMin: number; sessionType: string }[]; }
export interface MockQuestion { id: string; questionText: string; options: string[]; subjectId: string; year: number; }
export interface MockScoring { paperKey: string | null; program: string; stage: string; marksPerQuestion: number; negativeMarking: { kind: string; marks?: number; fraction?: number }; maximumScore: number; }
export interface MockScore { correctCount: number; incorrectCount: number; unansweredCount: number; obtainedScore: number; maximumScore: number; negativeMarks: number; }
export interface MockAttempt { id: string; title: string; durationSec: number; createdAt?: string; status: string; currentQuestion: number; answers: Record<string, number | null>; markedForReview: string[]; obtainedScore?: number | null; maximumScore?: number | null; sectionTimings?: Record<string, { questionCount: number; durationSec: number; questionIds?: string[] }>; }
export type ExternalPaperMistakeTag = 'CONCEPT_GAP' | 'SILLY_MISTAKE' | 'TIME_PRESSURE' | 'REVISION_GAP' | 'UNATTEMPTED';
export interface ExternalPaperBreakdown { label: string; obtainedScore: number; maxScore: number; }
export interface ExternalPaperReviewInput { title: string; sourceName?: string; testDate: string; obtainedScore: number; maxScore: number; breakdown?: ExternalPaperBreakdown[]; mistakeTags?: ExternalPaperMistakeTag[]; selfNotes?: string; documentId?: string; }
export interface ExternalPaperAnalysis { scorePercent: number; previousScorePercent: number | null; scoreChangePoints: number | null; confidence: { level: 'EARLY_SIGNAL' | 'PATTERN_FORMING'; message: string }; encouragement: string; priorityAreas: Array<{ label: string; scorePercent: number; reason: string }>; actionPlan: string[]; disclaimer: string; }
export interface ExternalPaperReview { id: string; title: string; sourceName: string | null; testDate: string; obtainedScore: number; maxScore: number; breakdown: ExternalPaperBreakdown[]; mistakeTags: ExternalPaperMistakeTag[]; selfNotes: string | null; documentId: string | null; analysis: ExternalPaperAnalysis; createdAt: string; }
export interface Counselling { roles: Array<{ name: string; fit: string; next: string }>; disclaimer: string; }
export interface VoiceNote { id: string; title: string; audioUri?: string | null; transcription?: string | null; durationSec?: number | null; tags: string[]; }
export interface PdfDocument { id: string; title: string; fileUrl: string | null; fileName?: string | null; fileMimeType?: string | null; fileChecksum?: string | null; localUri?: string; pageImageUris?: Record<string, string>; extractedText?: string | null; pageText?: unknown; pageCount: number | null; tags: string[]; }
export interface PdfAnnotation { id: string; documentId: string; page: number; type: string; quote: string | null; note: string | null; color?: string; selectionStart?: number | null; selectionEnd?: number | null; rect?: { x: number; y: number; width: number; height: number } | null; updatedAt?: string; }
export interface AmbientMode { id: string; label: string; url: string | null; loop: boolean; }
