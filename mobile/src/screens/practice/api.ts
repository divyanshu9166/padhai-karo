/**
 * Practice-feature API helpers and DTOs (task 21.6).
 *
 * Thin typed wrappers over the Backend_API endpoints used by the PYQ practice, Timed Paper
 * Mode, and Mistake Journal screens. Kept local to the Practice feature folder (rather than in
 * the shared `src/api` layer) so this task stays self-contained; everything is built on the
 * existing generic {@link request} client, which attaches the session token and parses the
 * standard error envelope.
 *
 * Endpoints (design "PYQ Practice + Scoring Service", "Timed Paper Mode Service",
 * "Mistake Journal Service"):
 *   - GET    /profile                          → resolve the user's Exam_Track for filters
 *   - GET    /reference/subjects?track=         → subject picker options (id === reference key)
 *   - GET    /pyqs?year=&subjectId=             → practice questions (no answer key) (Req 6.1)
 *   - POST   /pyq-attempts                      → score + persist a PYQ attempt (Req 6.2–6.5)
 *   - GET    /papers/:id                        → paper duration + questions (Req 19.1)
 *   - POST   /timed-attempts                    → score + persist a timed attempt (Req 19.5–19.8)
 *   - POST   /mistakes                          → flag a question into the journal (Req 18.1)
 *   - GET    /mistakes?subjectId=&category=     → browse the journal, filtered (Req 18.5/18.6)
 */
import { request } from '@/api';

// ── Shared enums (mirror the backend string contracts) ──────────────────────────────────────

export type ExamTrack = 'JEE' | 'NEET';

/** Per-question outcome from the shared scoring function. */
export type QuestionOutcome = 'CORRECT' | 'INCORRECT' | 'UNANSWERED';

/** The four Mistake_Category values (Req 18.2). */
export type MistakeCategory =
    | 'SILLY_MISTAKE'
    | 'CONCEPT_GAP'
    | 'TIME_PRESSURE'
    | 'NEVER_SEEN_THIS';

/** Which attempt table a flagged question is sourced from. */
export type MistakeSourceType = 'PYQ' | 'TIMED';

// ── DTOs ──────────────────────────────────────────────────────────────────────────────────

/** A reference subject. Its `key` is the value used as `subjectId` in PYQ/paper rows. */
export interface ReferenceSubject {
    key: string;
    name: string;
    examTrack: ExamTrack;
}

/** A practice question as returned to the client — never carries the answer key. */
export interface ClientPYQ {
    id: string;
    questionText: string;
    options: string[];
}

/** A single graded question (selected/correct options are stringified 0-based indices). */
export interface PerQuestionResult {
    questionId: string;
    selectedOption: string | null;
    correctOption: string;
    outcome: QuestionOutcome;
}

/** The 201 response from submitting a PYQ or timed attempt. */
export interface AttemptResult {
    attemptId: string;
    totalScore: number;
    perQuestion: PerQuestionResult[];
}

/** Paper metadata returned alongside its questions. */
export interface PaperSummary {
    id: string;
    examTrack: ExamTrack;
    year: number;
    session: string;
}

/** The `GET /papers/:id` response: metadata, standard duration, and answer-less questions. */
export interface PaperResponse {
    paper: PaperSummary;
    durationMin: number;
    questions: ClientPYQ[];
}

/** A persisted Mistake Journal entry. */
export interface MistakeEntry {
    id: string;
    questionId: string;
    subjectId: string;
    sourceType: MistakeSourceType;
    submittedAnswer: number | null;
    correctAnswer: number;
    category: MistakeCategory;
    note: string | null;
    createdAt: string;
    updatedAt: string;
}

/** One answer in an attempt submission. A `null`/omitted option means unanswered. */
export interface AttemptAnswer {
    questionId: string;
    selectedOption: number | null;
}

// ── Calls ───────────────────────────────────────────────────────────────────────────────────

/** Resolve the authenticated user's Exam_Track from their profile (drives subject filters). */
export async function getProfileTrack(): Promise<ExamTrack> {
    const res = await request<{ profile: { examTrack: ExamTrack } }>('/profile');
    return res.profile.examTrack;
}

/** List the subjects for a track; each subject's `key` is a valid `subjectId` filter value. */
export async function listSubjects(track: ExamTrack): Promise<ReferenceSubject[]> {
    const res = await request<{ subjects: ReferenceSubject[] }>(
        `/reference/subjects?track=${encodeURIComponent(track)}`,
    );
    return res.subjects;
}

/** Fetch practice questions for a year + subject (no answer key is returned). */
export async function listPyqs(year: number, subjectId: string): Promise<ClientPYQ[]> {
    const res = await request<{ questions: ClientPYQ[] }>(
        `/pyqs?year=${encodeURIComponent(String(year))}&subjectId=${encodeURIComponent(subjectId)}`,
    );
    return res.questions;
}

/** Submit a PYQ attempt for scoring; the server resolves the answer key. */
export function submitPyqAttempt(input: {
    paperOrSetRef: string;
    answers: AttemptAnswer[];
}): Promise<AttemptResult> {
    return request<AttemptResult>('/pyq-attempts', { method: 'POST', body: input });
}

/** Fetch a timed paper's duration and questions. */
export function getPaper(paperId: string): Promise<PaperResponse> {
    return request<PaperResponse>(`/papers/${encodeURIComponent(paperId)}`);
}

/** Submit a timed-paper attempt (every paper question is scored server-side). */
export function submitTimedAttempt(input: {
    paperId: string;
    answers: AttemptAnswer[];
    timeTakenSec: number;
}): Promise<AttemptResult> {
    return request<AttemptResult>('/timed-attempts', { method: 'POST', body: input });
}

/** Flag a question from an attempt into the categorized Mistake Journal (Req 18.1). */
export function flagMistake(input: {
    sourceType: MistakeSourceType;
    attemptId: string;
    questionId: string;
    category: MistakeCategory;
    note?: string;
}): Promise<{ entry: MistakeEntry }> {
    return request<{ entry: MistakeEntry }>('/mistakes', { method: 'POST', body: input });
}

/** Browse the user's Mistake Journal, optionally filtered by subject and/or category. */
export async function listMistakes(filter: {
    subjectId?: string | null;
    category?: MistakeCategory | null;
}): Promise<MistakeEntry[]> {
    const params = new URLSearchParams();
    if (filter.subjectId) params.set('subjectId', filter.subjectId);
    if (filter.category) params.set('category', filter.category);
    const qs = params.toString();
    const res = await request<{ entries: MistakeEntry[] }>(`/mistakes${qs ? `?${qs}` : ''}`);
    return res.entries;
}

// ── Display helpers ─────────────────────────────────────────────────────────────────────────

/** The four categories with their localization keys, for category pickers/filters. */
export const MISTAKE_CATEGORY_OPTIONS: readonly {
    value: MistakeCategory;
    labelKey: string;
}[] = [
        { value: 'SILLY_MISTAKE', labelKey: 'mistakes.category.silly' },
        { value: 'CONCEPT_GAP', labelKey: 'mistakes.category.conceptGap' },
        { value: 'TIME_PRESSURE', labelKey: 'mistakes.category.timePressure' },
        { value: 'NEVER_SEEN_THIS', labelKey: 'mistakes.category.neverSeen' },
    ];

/** A question outcome is journal-eligible when it was incorrect or left unanswered (Req 18.3). */
export function isFlaggable(outcome: QuestionOutcome): boolean {
    return outcome === 'INCORRECT' || outcome === 'UNANSWERED';
}
