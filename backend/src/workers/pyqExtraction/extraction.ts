/**
 * Pure extraction, sanitization, reconciliation, and option-count gating logic for the
 * PYQ extraction pipeline (task 12.1, Req 7.1–7.4).
 *
 * Everything in this module is a pure function of its inputs — no Prisma, Redis, BullMQ,
 * network, or clock access — so it is trivially unit-testable and is reused by the worker
 * processor in `worker.ts`. The worker is responsible only for I/O (calling the
 * {@link VisionExtractor}, loading the Answer_Key, and upserting records).
 *
 * UNTRUSTED INPUT: the vision model output is treated as untrusted (design "Malformed /
 * Untrusted External Content"). Each item is structurally validated; malformed items are
 * skipped (recorded as failures) WITHOUT affecting valid items; text is sanitized (markup
 * and control characters stripped) and is never executed; and the stored correct answer is
 * ALWAYS overwritten from the official Answer_Key, never trusted from the model (Req 7.2).
 */
import { createHash } from 'node:crypto';

import type {
    ExtractionAssociation,
    ExtractionFailure,
    ExtractionOutcome,
    OfficialAnswerKey,
    PyqUpsertRecord,
    RawExtractedQuestion,
    VisionExtractionResult,
} from './types';

/** The exact number of options a PYQ must have to be practice-eligible (Req 7.1/7.3). */
export const REQUIRED_OPTION_COUNT = 4;

/** Sentinel `correctOption` used when no official key entry exists for a question. */
export const NO_RECONCILED_KEY = -1;

/**
 * Sanitize a single piece of model-produced text before storage. The model output is
 * untrusted, so this:
 *  - removes HTML/XML-like tags (`<script>…`, `<b>`, etc.) so nothing renders as markup,
 *  - strips control characters (except none are preserved — tabs/newlines collapse to a
 *    space) so stored text is plain,
 *  - collapses runs of whitespace and trims.
 *
 * The result is treated strictly as data; it is never evaluated or used to build queries.
 */
export function sanitizeText(value: string): string {
    return value
        // Drop anything that looks like a tag, including unclosed `<script ...` fragments.
        .replace(/<[^>]*>/g, '')
        .replace(/<[^<]*$/g, '')
        // eslint-disable-next-line no-control-regex
        .replace(/[\u0000-\u001f\u007f]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Derive a deterministic, collision-resistant idempotency key for a single extracted
 * question from the source image reference and the question reference. Re-running the
 * pipeline over the same source ref yields the same key for the same question, so the
 * upsert in the worker updates in place rather than inserting a duplicate.
 *
 * Pure and deterministic: a SHA-256 over the normalized `sourceImageRef` + `questionRef`,
 * domain-prefixed so keys can never collide with other id spaces.
 */
export function deriveIdempotencyKey(sourceImageRef: string, questionRef: string): string {
    const normalizedSource = sourceImageRef.trim();
    const normalizedQuestion = questionRef.trim();
    const hash = createHash('sha256')
        .update('pyq-extraction:v1\u0000')
        .update(normalizedSource)
        .update('\u0000')
        .update(normalizedQuestion)
        .digest('hex');
    return `pyq_${hash}`;
}

/**
 * Normalize the persisted `AnswerKey.entries` JSON into an {@link OfficialAnswerKey}.
 *
 * The stored shape is `{ questionRef: correctOptionIndex }` (design Data Models). This
 * coerces each value to a non-negative integer option index, silently skipping entries
 * that are not coercible to a valid index (defensive: the key is operator data but is
 * still validated rather than trusted blindly).
 */
export function parseOfficialAnswerKey(entries: unknown): OfficialAnswerKey {
    const normalized: Record<string, number> = {};
    if (entries === null || typeof entries !== 'object' || Array.isArray(entries)) {
        return { entries: normalized };
    }
    for (const [questionRef, rawValue] of Object.entries(entries as Record<string, unknown>)) {
        const index = toOptionIndex(rawValue);
        if (index !== null) {
            normalized[questionRef] = index;
        }
    }
    return { entries: normalized };
}

/** Coerce an untrusted answer-key value to a non-negative integer option index, or null. */
function toOptionIndex(value: unknown): number | null {
    if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
        return value;
    }
    if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
        return Number.parseInt(value.trim(), 10);
    }
    return null;
}

/**
 * Structurally validate one untrusted extracted question. Returns the cleaned shape when
 * the item matches the expected schema, or a failure describing why it was rejected.
 *
 * An item is malformed (and skipped, Req design "Malformed model JSON fails the job item
 * without affecting valid items") when it is not an object, lacks a usable `questionRef`,
 * lacks a string `questionText`, or `options` is not an array of strings. Note that an
 * item with the WRONG NUMBER of options is NOT malformed — it is valid-but-flagged (Req
 * 7.3); only items that cannot be interpreted at all are failures here.
 */
export function validateExtractedQuestion(
    raw: unknown,
): { ok: true; value: RawExtractedQuestion } | { ok: false; failure: ExtractionFailure } {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
        return { ok: false, failure: { questionRef: null, reason: 'item is not an object' } };
    }
    const candidate = raw as Record<string, unknown>;

    const questionRef =
        typeof candidate.questionRef === 'string' && candidate.questionRef.trim() !== ''
            ? candidate.questionRef.trim()
            : null;
    if (questionRef === null) {
        return { ok: false, failure: { questionRef: null, reason: 'missing or empty questionRef' } };
    }

    if (typeof candidate.questionText !== 'string') {
        return { ok: false, failure: { questionRef, reason: 'questionText is not a string' } };
    }

    if (
        !Array.isArray(candidate.options) ||
        !candidate.options.every((option) => typeof option === 'string')
    ) {
        return { ok: false, failure: { questionRef, reason: 'options is not an array of strings' } };
    }

    const modelCorrectOption =
        typeof candidate.modelCorrectOption === 'number' ? candidate.modelCorrectOption : null;

    return {
        ok: true,
        value: {
            questionRef,
            questionText: candidate.questionText,
            options: candidate.options as string[],
            modelCorrectOption,
        },
    };
}

/**
 * Reconcile the correct answer for a question against the official Answer_Key (Req 7.2).
 *
 * Returns the key's correct option index for the question's `questionRef`, completely
 * ignoring any value the model proposed. When the key has no entry for the question,
 * returns {@link NO_RECONCILED_KEY} to signal that the record cannot be made
 * practice-eligible.
 */
export function reconcileCorrectOption(
    questionRef: string,
    officialKey: OfficialAnswerKey,
): number {
    const reconciled = officialKey.entries[questionRef];
    return reconciled === undefined ? NO_RECONCILED_KEY : reconciled;
}

/**
 * Decide whether a record is practice-eligible. A record is eligible (NOT flagged) only
 * when it has exactly four options AND a reconciled key whose index is in range for those
 * options. Anything else is flagged for manual review and excluded from practice (Req 7.3).
 */
export function isFlaggedForReview(optionCount: number, reconciledOption: number): boolean {
    const hasExactlyFour = optionCount === REQUIRED_OPTION_COUNT;
    const hasReconciledKey = reconciledOption !== NO_RECONCILED_KEY;
    const keyInRange = reconciledOption >= 0 && reconciledOption < optionCount;
    return !(hasExactlyFour && hasReconciledKey && keyInRange);
}

/**
 * Build a single storable PYQ record from a validated extracted question, the association
 * metadata, and the official key. Sanitizes all text, derives the idempotency key,
 * reconciles the correct answer from the key (Req 7.2), associates track/year/subject (Req
 * 7.4), and applies option-count + key gating to set `flaggedForReview` (Req 7.3).
 */
export function buildPyqRecord(
    raw: RawExtractedQuestion,
    association: ExtractionAssociation,
    officialKey: OfficialAnswerKey,
    sourceImageRef: string,
    paperId: string | null = null,
): PyqUpsertRecord {
    const options = raw.options.map(sanitizeText);
    const reconciledOption = reconcileCorrectOption(raw.questionRef, officialKey);
    const flaggedForReview = isFlaggedForReview(options.length, reconciledOption);

    return {
        id: deriveIdempotencyKey(sourceImageRef, raw.questionRef),
        paperId,
        examTrack: association.examTrack,
        year: association.year,
        subjectId: association.subjectId,
        questionText: sanitizeText(raw.questionText),
        options,
        correctOption: reconciledOption,
        flaggedForReview,
    };
}

/**
 * Transform a full extraction result into storable records and a list of skipped failures.
 *
 * Each question is validated independently: a malformed item is recorded as a failure and
 * skipped without affecting the valid items (design "Malformed model JSON fails the job
 * item without affecting valid items"). Valid items are turned into reconciled, gated,
 * associated PYQ records via {@link buildPyqRecord}.
 *
 * This is the pure heart of the pipeline; the worker simply persists `outcome.records`.
 */
export function processExtractionResult(
    result: VisionExtractionResult,
    association: ExtractionAssociation,
    officialKey: OfficialAnswerKey,
    sourceImageRef: string,
    paperId: string | null = null,
): ExtractionOutcome {
    const records: PyqUpsertRecord[] = [];
    const failures: ExtractionFailure[] = [];

    const rawQuestions = Array.isArray(result?.questions) ? result.questions : [];
    for (const rawQuestion of rawQuestions) {
        const validated = validateExtractedQuestion(rawQuestion);
        if (!validated.ok) {
            failures.push(validated.failure);
            continue;
        }
        records.push(
            buildPyqRecord(validated.value, association, officialKey, sourceImageRef, paperId),
        );
    }

    return { records, failures };
}
