/**
 * Types for the PYQ extraction pipeline (task 12.1, design "PYQ Extraction Pipeline (Worker, Req 7)").
 *
 * The pipeline turns operator-supplied source page images into structured PYQ records
 * (question text + exactly four options + a correct-answer reference), reconciles the
 * stored correct answer to the official Answer_Key, flags records without exactly four
 * options for manual review (excluding them from practice), and associates each record
 * with its Exam_Track / year / Subject (Req 7.1–7.4).
 *
 * The AI provider is abstracted behind the {@link VisionExtractor} interface so it can be
 * mocked in tests and a concrete Gemini/Claude client slotted in without touching the
 * worker or the pure extraction logic. Model output is treated as UNTRUSTED throughout:
 * see `extraction.ts` for structural validation, sanitization, and key reconciliation.
 */
import type { ExamTrack } from '@prisma/client';

/**
 * One question as returned by the vision model. This is UNTRUSTED data: fields may be
 * missing, mis-typed, contain unsafe markup, or carry a wrong/garbage answer. It is
 * structurally validated and sanitized before anything is stored, and `modelCorrectOption`
 * is NEVER trusted — the stored correct answer is always overwritten from the official
 * Answer_Key (Req 7.2).
 */
export interface RawExtractedQuestion {
    /**
     * A stable per-question reference within the source (e.g. the printed question number
     * or paper question id). Used both to look up the official key entry (Req 7.2) and to
     * derive the idempotency key so re-processing the same source does not duplicate.
     */
    questionRef: string;
    /** The model-transcribed question text (untrusted; sanitized before storage). */
    questionText: string;
    /** The model-transcribed options (untrusted; may not be exactly four — Req 7.1/7.3). */
    options: string[];
    /**
     * The model's guess at the correct option index. Recorded only for diagnostics; it is
     * intentionally IGNORED for the stored value, which is reconciled from the official
     * Answer_Key (Req 7.2).
     */
    modelCorrectOption?: number | null;
}

/** The structured result of extracting one source page image. */
export interface VisionExtractionResult {
    questions: RawExtractedQuestion[];
}

/** Inputs identifying which source image to extract and how the result is associated. */
export interface VisionExtractionInput {
    /** Stable reference to the source page image (e.g. object-store key or URL). */
    sourceImageRef: string;
    examTrack: ExamTrack;
    year: number;
    subjectId: string;
}

/**
 * The AI-provider seam. A concrete implementation (Gemini/Claude vision client) lives in
 * `visionExtractor.ts`; tests supply a mock. The worker depends only on this interface, so
 * no live API call runs during tests.
 */
export interface VisionExtractor {
    extractQuestionsFromImage(input: VisionExtractionInput): Promise<VisionExtractionResult>;
}

/** How extracted questions are associated with reference data (Req 7.4). */
export interface ExtractionAssociation {
    examTrack: ExamTrack;
    year: number;
    subjectId: string;
}

/**
 * The official final Answer_Key, normalized to a map of question reference -> correct
 * option index. Built from the persisted `AnswerKey.entries` JSON via
 * {@link parseOfficialAnswerKey}. This is the ONLY source of truth for the stored correct
 * answer (Req 7.2).
 */
export interface OfficialAnswerKey {
    /** Map of `questionRef` -> 0-based correct option index. */
    entries: Record<string, number>;
}

/**
 * A PYQ record ready to be persisted (upserted). Mirrors the practice-relevant columns of
 * the Prisma `PYQ` model. `id` is the derived idempotency key so re-runs upsert in place
 * rather than inserting duplicates.
 */
export interface PyqUpsertRecord {
    /** Deterministic idempotency key derived from the source ref + question ref. */
    id: string;
    paperId: string | null;
    examTrack: ExamTrack;
    year: number;
    subjectId: string;
    questionText: string;
    options: string[];
    /** Reconciled from the official key (Req 7.2); -1 sentinel when no key entry exists. */
    correctOption: number;
    /** True when not practice-eligible: not exactly four options or no reconciled key (Req 7.3). */
    flaggedForReview: boolean;
}

/** A source item that could not be turned into a record (malformed model JSON for an item). */
export interface ExtractionFailure {
    questionRef: string | null;
    reason: string;
}

/** The result of transforming one extraction result into storable records + failures. */
export interface ExtractionOutcome {
    records: PyqUpsertRecord[];
    /** Items that failed structural validation; skipped without affecting valid items. */
    failures: ExtractionFailure[];
}

/** Job payload for the `pyq-extraction` queue (design table, Req 7.1). */
export interface PyqExtractionJobData {
    sourceImageRefs: string[];
    examTrack: ExamTrack;
    year: number;
    subjectId: string;
    answerKeyId: string;
    /** Optional paper association; null for ad-hoc question sets. */
    paperId?: string | null;
}

/** Summary returned by the job processor (design GET job endpoint shape, Req 7.1/7.3). */
export interface PyqExtractionJobResult {
    /** Total PYQ records produced (created or updated). */
    produced: number;
    /** How many of the produced records were flagged for manual review (Req 7.3). */
    flaggedForReview: number;
    /** Source items skipped due to malformed model output. */
    failures: ExtractionFailure[];
}
