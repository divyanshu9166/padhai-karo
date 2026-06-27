/**
 * Onboarding API types + call (task 21.2).
 *
 * A thin, local wrapper over the typed client's generic `request` for `POST /onboarding`
 * (design "Onboarding / Profile Service"). It is kept inside the onboarding screen folder so
 * task 21.2 stays scoped to its own files; the shared `src/api` surface is untouched (other
 * feature-screen tasks add their own endpoint wrappers independently).
 *
 * The payload mirrors the Backend_API contract:
 *   `{ examTrack, targetYear, currentClass, fixedCommitments[], peakFocusWindows[] }`
 * and the server enforces the same validation the screen pre-checks (Req 2.2, 2.3).
 */
import { request } from '@/api';

/** Exam track chosen at onboarding (mirrors the Prisma `ExamTrack` enum). */
export type ExamTrack = 'JEE' | 'NEET';

/** Peak focus window the user can mark as high-energy (mirrors `PeakFocusWindow`, Req 2.8). */
export type PeakFocusWindow = 'MORNING' | 'AFTERNOON' | 'NIGHT';

/** A single recurring unavailable block supplied during onboarding (Req 2.1, 2.3). */
export interface FixedCommitmentInput {
    /** Day of week, 0 (Sunday) – 6 (Saturday). */
    dayOfWeek: number;
    /** Local start time as "HH:mm" (24-hour). */
    startTime: string;
    /** Local end time as "HH:mm" (24-hour); must be strictly later than `startTime`. */
    endTime: string;
    /** Human-readable label (e.g. "School", "Coaching"). */
    label: string;
}

/** The onboarding request body (Req 2.1, 2.8, 2.9). */
export interface OnboardingPayload {
    examTrack: ExamTrack;
    targetYear: number;
    currentClass: string;
    fixedCommitments: FixedCommitmentInput[];
    /** May be empty — empty means no high-energy bands (Req 2.9). */
    peakFocusWindows: PeakFocusWindow[];
}

/** `200 { profile, chaptersAssociated }` response of `POST /onboarding`. */
export interface OnboardingResponse {
    profile: unknown;
    chaptersAssociated: boolean;
}

/** `POST /onboarding` — persist the profile and load the track's reference chapters (Req 2.4). */
export function submitOnboarding(payload: OnboardingPayload): Promise<OnboardingResponse> {
    return request<OnboardingResponse>('/onboarding', { method: 'POST', body: payload });
}
