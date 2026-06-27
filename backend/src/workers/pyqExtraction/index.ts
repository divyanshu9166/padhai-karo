/**
 * Public surface of the PYQ extraction pipeline (task 12.1, Req 7).
 *
 * Exposes the pure extraction/reconciliation/gating helpers, the worker job processor and
 * factory, the concrete provider extractor, and the shared types. The job-submission and
 * status endpoints (task 12.2) and the Property 34 / worker integration tests (tasks
 * 12.3/12.4) build on these.
 */
export {
    REQUIRED_OPTION_COUNT,
    NO_RECONCILED_KEY,
    sanitizeText,
    deriveIdempotencyKey,
    parseOfficialAnswerKey,
    validateExtractedQuestion,
    reconcileCorrectOption,
    isFlaggedForReview,
    buildPyqRecord,
    processExtractionResult,
} from './extraction';

export {
    processPyqExtractionJob,
    createPyqExtractionWorker,
    type PyqExtractionDb,
    type PyqExtractionDeps,
    type PyqCreateInput,
    type PyqUpdateInput,
} from './worker';

export { ProviderVisionExtractor } from './visionExtractor';

export type {
    RawExtractedQuestion,
    VisionExtractionResult,
    VisionExtractionInput,
    VisionExtractor,
    ExtractionAssociation,
    OfficialAnswerKey,
    PyqUpsertRecord,
    ExtractionFailure,
    ExtractionOutcome,
    PyqExtractionJobData,
    PyqExtractionJobResult,
} from './types';
