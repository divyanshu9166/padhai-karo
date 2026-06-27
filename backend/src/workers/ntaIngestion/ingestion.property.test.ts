import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { parseAndValidate } from './parse';
import {
    runNtaIngestion,
    type NtaIngestionPrisma,
} from './worker';
import { EXAM_SCOPES, type NtaSource, type RawNtaItem } from './types';

/**
 * Property-based test for the NTA ingestion pipeline (task 17.3).
 *
 * Drives the real worker orchestration {@link runNtaIngestion} (sanitize → skip malformed →
 * de-duplicate by `dedupeHash`) over a generated batch of raw items, against an in-memory
 * Prisma stand-in. No live network/Redis/DB is touched. See design "Correctness Properties"
 * → Property 44.
 *
 * Validates: Requirements 20.2, 20.3, 20.4
 */

const examScopeArb = fc.constantFrom(...EXAM_SCOPES);

/** Plain-text phrase (letters/digits only) — always non-empty after sanitization. */
const phraseArb = fc
    .array(
        fc.constantFrom('Admit', 'Card', 'Exam', 'Date', 'Result', 'Notice', 'Schedule', '2026'),
        { minLength: 1, maxLength: 4 },
    )
    .map((words) => words.join(' '));

type MarkupKind = 'plain' | 'para' | 'script' | 'entity' | 'spaces';
const markupKindArb = fc.constantFrom<MarkupKind>('plain', 'para', 'script', 'entity', 'spaces');

/** Wrap a plain phrase in markup the sanitizer must strip — the words always survive. */
function applyMarkup(kind: MarkupKind, text: string): string {
    switch (kind) {
        case 'para':
            return `<p>${text}</p>`;
        case 'script':
            return `<script>steal()</script>${text}`;
        case 'entity':
            return `&lt;b&gt;${text}&lt;/b&gt;`;
        case 'spaces':
            return `   ${text}\n\t  `;
        default:
            return text;
    }
}

/** A range of timestamps used for publishedAt / newExamDate. */
const MIN_MS = Date.UTC(2024, 0, 1);
const MAX_MS = Date.UTC(2027, 0, 1);
const msArb = fc.integer({ min: MIN_MS, max: MAX_MS });

interface ValidSpec {
    scope: (typeof EXAM_SCOPES)[number];
    titlePhrase: string;
    bodyPhrase: string;
    markupKind: MarkupKind;
    publishedAtMs: number;
    affects: boolean;
    newExamMs: number;
}

const validSpecArb: fc.Arbitrary<ValidSpec> = fc.record({
    scope: examScopeArb,
    titlePhrase: phraseArb,
    bodyPhrase: phraseArb,
    markupKind: markupKindArb,
    publishedAtMs: msArb,
    affects: fc.boolean(),
    newExamMs: msArb,
});

/** A valid spec plus how many times it is repeated in the batch (to exercise dedupe). */
const validEntryArb = fc.record({ spec: validSpecArb, repeat: fc.integer({ min: 1, max: 3 }) });

function buildValidRaw(spec: ValidSpec): RawNtaItem {
    return {
        examScope: spec.scope,
        title: applyMarkup(spec.markupKind, spec.titlePhrase),
        body: applyMarkup(spec.markupKind, spec.bodyPhrase),
        publishedAt: new Date(spec.publishedAtMs).toISOString(),
        affectsExamDate: spec.affects,
        newExamDate: spec.affects ? new Date(spec.newExamMs).toISOString() : undefined,
    };
}

/** Each variant is guaranteed to FAIL parseAndValidate, so it must never be stored. */
const malformedArb: fc.Arbitrary<RawNtaItem> = fc.oneof(
    // Unrecognized exam scope.
    fc.record({
        examScope: fc.constant('SAT'),
        title: phraseArb,
        body: phraseArb,
        publishedAt: fc.constant('2025-01-01T00:00:00.000Z'),
    }),
    // Title empty after sanitization.
    fc.record({
        examScope: examScopeArb,
        title: fc.constant('<br/>'),
        body: phraseArb,
        publishedAt: fc.constant('2025-01-01T00:00:00.000Z'),
    }),
    // Unparseable publishedAt.
    fc.record({
        examScope: examScopeArb,
        title: phraseArb,
        body: phraseArb,
        publishedAt: fc.constant('not-a-real-date'),
    }),
    // Claims an exam-date change but supplies no valid date.
    fc.record({
        examScope: examScopeArb,
        title: phraseArb,
        body: phraseArb,
        publishedAt: fc.constant('2025-01-01T00:00:00.000Z'),
        affectsExamDate: fc.constant(true),
        newExamDate: fc.constant('nope'),
    }),
) as fc.Arbitrary<RawNtaItem>;

interface StoredRow {
    id: string;
    examScope: string;
    title: string;
    body: string;
    publishedAt: Date;
    dedupeHash: string;
    affectsExamDate: boolean;
    newExamDate: Date | null;
}

/** In-memory Prisma stand-in implementing exactly the slice the worker needs. */
function makeFakePrisma(): { rows: StoredRow[] } & NtaIngestionPrisma {
    const rows: StoredRow[] = [];
    let seq = 0;
    return {
        rows,
        nTAAnnouncement: {
            findUnique: async ({ where }) =>
                rows.find((r) => r.dedupeHash === where.dedupeHash) ?? null,
            create: async ({ data }) => {
                const row: StoredRow = { id: `srv-${seq++}`, ...data };
                rows.push(row);
                return { id: row.id };
            },
        },
        // No profiles → exam-date propagation is a no-op for this property.
        profile: {
            findMany: async () => [],
            update: async () => ({}),
        },
    };
}

function source(items: RawNtaItem[]): NtaSource {
    return { fetchAnnouncements: async () => items };
}

describe('Property 44: Ingestion sanitizes, skips malformed, and de-duplicates', () => {
    // Feature: jee-neet-study-app, Property 44: For any batch of raw NTA items, every stored announcement has sanitized content, malformed/unparseable items are not stored, and duplicate items collapse to a single stored announcement.
    it('stores only sanitized, de-duplicated valid announcements and skips malformed items', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.array(validEntryArb, { minLength: 1, maxLength: 6 }),
                fc.array(malformedArb, { maxLength: 4 }),
                async (validEntries, malformedItems) => {
                    const rawItems: RawNtaItem[] = [];
                    for (const { spec, repeat } of validEntries) {
                        const raw = buildValidRaw(spec);
                        for (let i = 0; i < repeat; i += 1) {
                            rawItems.push(raw);
                        }
                    }
                    for (const m of malformedItems) {
                        rawItems.push(m);
                    }

                    // Expected outcome derived from the pure parser: valid items keyed by
                    // dedupeHash, malformed items dropped.
                    const parsed = rawItems.map((r) => parseAndValidate(r));
                    const okValues = parsed.flatMap((p) => (p.ok ? [p.value] : []));
                    const malformedCount = parsed.length - okValues.length;
                    const validHashes = new Set(okValues.map((v) => v.dedupeHash));

                    const fake = makeFakePrisma();
                    const result = await runNtaIngestion(source(rawItems), {
                        prisma: fake,
                        now: new Date('2025-06-01T00:00:00.000Z'),
                    });

                    // 1. Every stored announcement has sanitized content (no angle brackets).
                    for (const row of fake.rows) {
                        expect(row.title).not.toMatch(/[<>]/);
                        expect(row.body).not.toMatch(/[<>]/);
                    }

                    // 2. Malformed/unparseable items are not stored.
                    expect(result.skippedMalformed).toBe(malformedCount);

                    // 3. Duplicate items collapse to a single stored announcement.
                    const storedHashes = fake.rows.map((r) => r.dedupeHash);
                    expect(new Set(storedHashes).size).toBe(storedHashes.length);
                    expect(new Set(storedHashes)).toEqual(validHashes);
                    expect(result.stored).toBe(validHashes.size);
                    expect(fake.rows).toHaveLength(validHashes.size);
                },
            ),
        );
    });
});
