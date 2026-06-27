/**
 * Public surface of the `nta-ingestion` worker (Req 20).
 *
 * Pure helpers (sanitize, dedupe-hash, parse/validate, exam-date recompute) and the
 * orchestration/worker wiring are re-exported here so callers import from one place.
 */
export { sanitizeText, normalizeWhitespace } from './sanitize';
export { computeDedupeHash, type DedupeInput } from './dedupe';
export { parseAndValidate } from './parse';
export {
    computeTargetCompletionDate,
    computeCountdownDays,
    applyExamDateChange,
    type ProfileExamInput,
    type ProfileExamUpdate,
} from './examDate';
export {
    runNtaIngestion,
    createNtaIngestionWorker,
    scheduleNtaIngestion,
    NTA_INGESTION_JOB_NAME,
    DEFAULT_INGESTION_INTERVAL_MS,
    type NtaIngestionPrisma,
    type NtaIngestionDeps,
    type IngestionResult,
} from './worker';
export { HttpNtaSource, type HttpNtaSourceOptions } from './httpSource';
export {
    EXAM_SCOPES,
    examScopeToTrack,
    type ExamScope,
    type RawNtaItem,
    type SanitizedAnnouncement,
    type ParseResult,
    type NtaSource,
} from './types';
