/**
 * Timetable + calendar-event API calls (task 21.3).
 *
 * Typed wrappers over the Backend_API Timetable Generation Service endpoints (design
 * "Timetable Generation Service"; Req 3, 15, 16). The timetable screen (task 21.3) calls
 * these; all scheduling intelligence stays server-side — the client only renders the
 * returned blocks and submits edit/generate/rebalance intents.
 *
 *   POST   /timetable/generate            { weekStart }            -> { timetable, studyBlocks[], bufferSlots[] }
 *   GET    /timetable?weekStart=                                   -> { studyBlocks[] }   (study + buffer)
 *   PATCH  /timetable/blocks/:id          { startTime?, durationMin?, subjectId? }
 *                                                                   -> { studyBlock } | 409 TIMETABLE_OVERLAP
 *   DELETE /timetable/blocks/:id                                   -> 204
 *   POST   /timetable/blocks/:id/missed                            -> { rebalanced[], strategy }
 *   PATCH  /timetable/buffer-policy        { policy }              -> { bufferPolicy }
 *   POST   /calendar-events                { type, startDate, endDate } -> { event }
 *   GET    /calendar-events?from=&to=                              -> { events[] }
 *   GET    /calendar-events/holiday-sprint                         -> { offer }
 */

import { request } from './client';

// ── DTOs (mirror the Backend_API contracts) ────────────────────────────────────────────────

/** Energy tag the generator assigns to a block (Req 13.1). */
export type EnergyLevel = 'HIGH' | 'LOW';

/**
 * A persisted study block as returned by the timetable endpoints. A Buffer_Slot has
 * `isBuffer === true` and a null `subjectId`/`chapterId` (Req 15.1). `startTime` is an
 * ISO-8601 string as serialized over JSON.
 */
export interface StudyBlock {
    id: string;
    timetableId: string;
    userId: string;
    subjectId: string | null;
    chapterId: string | null;
    startTime: string;
    durationMin: number;
    isBuffer: boolean;
    energyLevel: EnergyLevel;
    scheduledOutsidePeak: boolean;
}

/** A generated weekly timetable header. `weekStart` is an ISO-8601 string. */
export interface Timetable {
    id: string;
    userId: string;
    weekStart: string;
}

/** Response of `POST /timetable/generate`: the timetable split into study and buffer blocks. */
export interface GenerateTimetableResponse {
    timetable: Timetable;
    studyBlocks: StudyBlock[];
    bufferSlots: StudyBlock[];
}

/** Response of `GET /timetable?weekStart=`: every block for the week (study + buffer). */
export interface GetTimetableResponse {
    studyBlocks: StudyBlock[];
}

/** Editable fields accepted by `PATCH /timetable/blocks/:id`. */
export interface EditBlockInput {
    /** New start time as an ISO-8601 string. */
    startTime?: string;
    /** New duration in whole minutes (> 0). */
    durationMin?: number;
    /** New subject id, or `null` to clear it. */
    subjectId?: string | null;
}

/** Response of `PATCH /timetable/blocks/:id` on success. */
export interface EditBlockResponse {
    studyBlock: StudyBlock;
}

/** The rebalancing strategy chosen for a missed block (Req 15.2/15.3). */
export type RebalanceStrategy = 'BUFFER_FILL' | 'COMPRESS' | 'NONE';

/** Response of `POST /timetable/blocks/:id/missed`. */
export interface MissedBlockResponse {
    rebalanced: StudyBlock[];
    strategy: RebalanceStrategy;
}

/** Buffer-policy options applied to unused end-of-week buffer (Req 15.4). */
export type BufferPolicy = 'CATCH_UP' | 'EXTRA_REVISION';

/** Response of `PATCH /timetable/buffer-policy`. */
export interface BufferPolicyResponse {
    bufferPolicy: BufferPolicy;
}

/** A calendar event the user can mark (Req 16.1). */
export type CalendarEventType = 'SCHOOL_EXAM' | 'HOLIDAY' | 'MOCK_TEST';

/** A persisted calendar event. `startDate`/`endDate` are ISO-8601 strings. */
export interface CalendarEvent {
    id: string;
    userId: string;
    type: CalendarEventType;
    startDate: string;
    endDate: string;
}

/** Body of `POST /calendar-events`. */
export interface CreateCalendarEventInput {
    type: CalendarEventType;
    startDate: string;
    endDate: string;
}

/** Response of `POST /calendar-events`. */
export interface CreateCalendarEventResponse {
    event: CalendarEvent;
}

/** Response of `GET /calendar-events`. */
export interface ListCalendarEventsResponse {
    events: CalendarEvent[];
}

/** The intensified holiday-sprint plan offered for an upcoming holiday (Req 16.6). */
export interface HolidaySprintPlan {
    startDate: string;
    endDate: string;
    days: number;
    defaultDailyHours: number;
    holidayFactor: number;
    suggestedDailyHours: number;
    suggestedTotalHours: number;
}

/** Offer envelope: `available: false` with `plan: null` when no holiday is upcoming. */
export type HolidaySprintOffer =
    | { available: true; plan: HolidaySprintPlan }
    | { available: false; plan: null };

/** Response of `GET /calendar-events/holiday-sprint`. */
export interface HolidaySprintResponse {
    offer: HolidaySprintOffer;
}

// ── Calls ───────────────────────────────────────────────────────────────────────────────────

/** `POST /timetable/generate` — (re)generate the week's timetable (Req 3.1). */
export function generateTimetable(weekStart: string): Promise<GenerateTimetableResponse> {
    return request<GenerateTimetableResponse>('/timetable/generate', {
        method: 'POST',
        body: { weekStart },
    });
}

/** `GET /timetable?weekStart=` — read the persisted blocks for a week (study + buffer). */
export function getTimetable(weekStart: string): Promise<GetTimetableResponse> {
    return request<GetTimetableResponse>(
        `/timetable?weekStart=${encodeURIComponent(weekStart)}`,
    );
}

/**
 * `PATCH /timetable/blocks/:id` — edit a block. The whole edit is rejected with a
 * `409 TIMETABLE_OVERLAP` {@link import('./client').ApiError} on overlap, leaving the original
 * block unchanged (Req 3.5); callers should branch on that to surface the conflict.
 */
export function editBlock(blockId: string, input: EditBlockInput): Promise<EditBlockResponse> {
    return request<EditBlockResponse>(`/timetable/blocks/${encodeURIComponent(blockId)}`, {
        method: 'PATCH',
        body: input,
    });
}

/** `DELETE /timetable/blocks/:id` — remove a block (Req 3.7). */
export function deleteBlock(blockId: string): Promise<void> {
    return request<void>(`/timetable/blocks/${encodeURIComponent(blockId)}`, {
        method: 'DELETE',
    });
}

/** `POST /timetable/blocks/:id/missed` — mark a block missed and rebalance (Req 15.2/15.3). */
export function markBlockMissed(blockId: string): Promise<MissedBlockResponse> {
    return request<MissedBlockResponse>(
        `/timetable/blocks/${encodeURIComponent(blockId)}/missed`,
        { method: 'POST' },
    );
}

/** `PATCH /timetable/buffer-policy` — set the unused-buffer conversion policy (Req 15.4). */
export function setBufferPolicy(policy: BufferPolicy): Promise<BufferPolicyResponse> {
    return request<BufferPolicyResponse>('/timetable/buffer-policy', {
        method: 'PATCH',
        body: { policy },
    });
}

/** `POST /calendar-events` — mark a School_Exam / Holiday / Mock_Test event (Req 16.1). */
export function createCalendarEvent(
    input: CreateCalendarEventInput,
): Promise<CreateCalendarEventResponse> {
    return request<CreateCalendarEventResponse>('/calendar-events', {
        method: 'POST',
        body: input,
    });
}

/** `GET /calendar-events?from=&to=` — list the user's calendar events. */
export function listCalendarEvents(range?: {
    from?: string;
    to?: string;
}): Promise<ListCalendarEventsResponse> {
    const params = new URLSearchParams();
    if (range?.from) params.set('from', range.from);
    if (range?.to) params.set('to', range.to);
    const query = params.toString();
    return request<ListCalendarEventsResponse>(`/calendar-events${query ? `?${query}` : ''}`);
}

/** `GET /calendar-events/holiday-sprint` — the upcoming holiday-sprint offer (Req 16.6). */
export function getHolidaySprintOffer(): Promise<HolidaySprintResponse> {
    return request<HolidaySprintResponse>('/calendar-events/holiday-sprint');
}
