/**
 * Focus-timer data access (task 21.4).
 *
 * Thin, screen-local wrappers over the shared typed API client (`@/api`). Kept inside the
 * focus folder so this task stays scoped to its screen; if other screens need focus or
 * subject DTOs later they can be promoted into `src/api`.
 *
 * Subject source (documented decision): the picker needs both display names AND valid
 * `Subject.id`s for the record FK. We read the user's `examTrack` from `GET /api/profile`
 * and then the track's catalog from `GET /api/reference/subjects?track=`. The reference
 * subject `key` IS the seeded `Subject.id` (see backend reference catalog), so it is a valid
 * `subjectId` for `POST /api/focus-sessions`, and the catalog carries human-readable names.
 */

import { request } from '@/api';

import type { SessionType } from './sessionTypes';

/** The user's Exam_Track, mirroring the backend `ExamTrack` enum (only JEE/NEET in Phase 1). */
export type ExamTrack = 'JEE' | 'NEET';

/** Shape of `GET /api/profile` (we only need `examTrack` here). */
interface ProfileResponse {
    profile: { examTrack: ExamTrack };
}

/** A reference subject as returned by `GET /api/reference/subjects` (`key` === `Subject.id`). */
interface ReferenceSubject {
    key: string;
    name: string;
    examTrack: ExamTrack;
}

interface SubjectsResponse {
    subjects: ReferenceSubject[];
}

/** A subject option for the picker: the FK `id` to record against and its display `name`. */
export interface SubjectOption {
    id: string;
    name: string;
}

/** Body for `POST /api/focus-sessions` (design "Focus Timer / Session Service"). */
export interface RecordFocusSessionBody {
    subjectId: string;
    /** ISO-8601 wall-clock start. */
    startTime: string;
    /** ISO-8601 wall-clock end. */
    endTime: string;
    /** Accumulated focused minutes (excludes paused time; integer > 0). */
    focusedDurationMin: number;
    sessionType: SessionType;
    /** Client-generated UUID for offline-idempotency-friendly recording (Req 21). */
    clientId: string;
}

/** The recorded session echoed back by the API (only the fields the screen may surface). */
export interface RecordedFocusSession {
    id: string;
    subjectId: string;
    focusedDurationMin: number;
    sessionType: SessionType;
}

interface RecordFocusSessionResponse {
    session: RecordedFocusSession;
}

/**
 * Load the authenticated user's selectable subjects: resolve the profile's `examTrack`, then
 * fetch that track's reference subjects. Returns picker-ready `{ id, name }` options.
 */
export async function fetchSubjectOptions(signal?: AbortSignal): Promise<SubjectOption[]> {
    const { profile } = await request<ProfileResponse>('/profile', { signal });
    const { subjects } = await request<SubjectsResponse>(
        `/reference/subjects?track=${encodeURIComponent(profile.examTrack)}`,
        { signal },
    );
    return subjects.map((subject) => ({ id: subject.key, name: subject.name }));
}

/** Record a completed focus session. Throws {@link import('@/api').ApiError} on 4xx/5xx. */
export async function recordFocusSession(
    body: RecordFocusSessionBody,
): Promise<RecordedFocusSession> {
    const { session } = await request<RecordFocusSessionResponse>('/focus-sessions', {
        method: 'POST',
        body,
    });
    return session;
}

/**
 * Generate a client UUID for the session's idempotency key. Prefers the platform
 * `crypto.randomUUID` when present and degrades to an RFC-4122-shaped v4 string built from
 * `Math.random` (sufficient as an idempotency key, not a security token).
 */
export function generateClientId(): string {
    const cryptoObj = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
    if (cryptoObj?.randomUUID) {
        return cryptoObj.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
        const rand = (Math.random() * 16) | 0;
        const value = char === 'x' ? rand : (rand & 0x3) | 0x8;
        return value.toString(16);
    });
}
