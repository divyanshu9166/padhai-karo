/**
 * Session_Type options for the focus timer (task 21.4; Req 4.6).
 *
 * The five Session_Type values mirror the Backend_API's `SessionType` enum exactly (design
 * "Focus Timer / Session Service"); an unknown value is rejected server-side with a 422, so
 * keeping this list in lockstep is what makes the tag selectable client-side without a
 * round-trip. `NEW_CHAPTER` is the server default when a session is recorded without a tag
 * (Req 4.8), so it is also the screen's initial selection.
 *
 * Labels are localized via the shared catalog where a key exists (`focus.sessionType.*`).
 * The catalog ships keys for New chapter / Practice problems / Revision today; Mock analysis
 * and Formula drill fall back to inline English here until task 21.8 finalizes localization
 * (this screen intentionally does not edit the shared catalog).
 */

/** The Session_Type wire values accepted by `POST /api/focus-sessions` (Req 4.6). */
export type SessionType =
    | 'NEW_CHAPTER'
    | 'PRACTICE_PROBLEMS'
    | 'REVISION'
    | 'MOCK_ANALYSIS'
    | 'FORMULA_DRILL';

/** The server default applied when no tag is supplied (Req 4.8); also the initial UI choice. */
export const DEFAULT_SESSION_TYPE: SessionType = 'NEW_CHAPTER';

/** A selectable Session_Type option: its wire value, optional catalog key, and English fallback. */
export interface SessionTypeOption {
    value: SessionType;
    /** Catalog key when one exists; `null` means render `fallbackLabel` directly. */
    labelKey: string | null;
    /** English label used when no catalog key exists (avoids editing the shared catalog). */
    fallbackLabel: string;
}

/** All five Session_Type options in display order (Req 4.6). */
export const SESSION_TYPE_OPTIONS: readonly SessionTypeOption[] = [
    { value: 'NEW_CHAPTER', labelKey: 'focus.sessionType.newChapter', fallbackLabel: 'New chapter' },
    {
        value: 'PRACTICE_PROBLEMS',
        labelKey: 'focus.sessionType.practiceProblems',
        fallbackLabel: 'Practice problems',
    },
    { value: 'REVISION', labelKey: 'focus.sessionType.revision', fallbackLabel: 'Revision' },
    { value: 'MOCK_ANALYSIS', labelKey: null, fallbackLabel: 'Mock analysis' },
    { value: 'FORMULA_DRILL', labelKey: null, fallbackLabel: 'Formula drill' },
];
