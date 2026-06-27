/**
 * Additive-migration smoke test for the Weightage-Based Time Allocation schema change
 * (task 1.3, Req 9.3, 9.4).
 *
 * Req 9.3: "WHEN this spec introduces new persisted data, THE Backend_API SHALL store the new
 * data only in newly added models or newly added columns, and SHALL leave every existing
 * Phase 1 and Performance Analytics model, column, and stored value unchanged with no renamed,
 * removed, retyped, or repurposed existing column."
 *
 * Req 9.4: "WHEN the Allocation_Service reads Phase 1 and Performance Analytics data, THE
 * Allocation_Service SHALL perform read-only access only..." — at the schema layer this means
 * the migration touches no existing table, column, or type.
 *
 * This test reads the generated migration SQL and asserts the change is *purely additive*:
 *   1. It creates ONLY the new `EffectiveAllocationMode` enum.
 *   2. It creates ONLY the two new tables (`AllocationPreference`, `SuggestedAllocationSnapshot`).
 *   3. Every `CREATE INDEX` is on one of those two new tables.
 *   4. Every `ALTER TABLE` targets a new table and only ADDs a FOREIGN KEY constraint that
 *      *references* the existing `User` table (the additive back-relation) — it never alters,
 *      drops, renames, or retypes any existing table, column, or constraint.
 *   5. The migration contains NO `DROP` statement of any kind.
 *   6. No statement targets any existing Phase 1 / Performance Analytics table.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** backend/src/lib/db -> backend/prisma/migrations/<name>/migration.sql */
const MIGRATION_PATH = path.resolve(
    HERE,
    '../../../prisma/migrations/20260627170429_add_weightage_allocation/migration.sql',
);

/** The enum this migration is allowed to create. */
const NEW_ENUM = 'EffectiveAllocationMode';

/** The tables this migration is allowed to create. */
const NEW_TABLES = ['AllocationPreference', 'SuggestedAllocationSnapshot'] as const;

/**
 * Every existing Phase 1 + Performance Analytics table (from the `_init` and
 * `_add_performance_analytics` migrations). The additive migration must touch none of these.
 */
const EXISTING_TABLES = [
    // Phase 1 (_init)
    'User',
    'Session',
    'Profile',
    'Subject',
    'Chapter',
    'FixedCommitment',
    'Timetable',
    'StudyBlock',
    'FocusSession',
    'DailyTimeAudit',
    'CalendarEvent',
    'PYQPaper',
    'AnswerKey',
    'PYQ',
    'PYQAttempt',
    'TimedPaperAttempt',
    'MistakeJournalEntry',
    'NoteSummary',
    'AiUsageEvent',
    'NTAAnnouncement',
    'Subscription',
    'Payment',
    'LocalSyncRecord',
    'OfflineDownload',
    // Performance Analytics (_add_performance_analytics)
    'ExternalMockScore',
    'TargetCollegeCutoffSelection',
    'QuestionTopicMap',
    'CutoffReferenceData',
    'ScoreStandingMap',
    'TopicFrequencyReferenceData',
] as const;

const migrationSql = readFileSync(MIGRATION_PATH, 'utf8');

/**
 * Split the migration into individual SQL statements, dropping Prisma's `-- Comment` header
 * lines and blank lines, then splitting on the statement terminator `;`.
 */
function statements(sql: string): string[] {
    const withoutComments = sql
        .split('\n')
        .filter((line) => !line.trim().startsWith('--'))
        .join('\n');

    return withoutComments
        .split(';')
        .map((s) => s.replace(/\s+/g, ' ').trim())
        .filter((s) => s.length > 0);
}

const allStatements = statements(migrationSql);

/** First matching capture group, or null. */
function match1(stmt: string, re: RegExp): string | null {
    const m = stmt.match(re);
    return m ? m[1] : null;
}

const createTypeNames = allStatements
    .map((s) => match1(s, /^CREATE TYPE "?([A-Za-z0-9_]+)"?/i))
    .filter((x): x is string => x !== null);

const createTableNames = allStatements
    .map((s) => match1(s, /^CREATE TABLE (?:IF NOT EXISTS )?"?([A-Za-z0-9_]+)"?/i))
    .filter((x): x is string => x !== null);

const createIndexTargets = allStatements
    .filter((s) => /^CREATE (?:UNIQUE )?INDEX/i.test(s))
    .map((s) => match1(s, /\bON "?([A-Za-z0-9_]+)"?/i))
    .filter((x): x is string => x !== null);

const alterTableStatements = allStatements.filter((s) => /^ALTER TABLE/i.test(s));

describe('weightage-allocation migration is purely additive (Req 9.3, 9.4)', () => {
    it('the migration file exists and is non-empty', () => {
        expect(migrationSql.trim().length).toBeGreaterThan(0);
        expect(allStatements.length).toBeGreaterThan(0);
    });

    it('creates only the new EffectiveAllocationMode enum', () => {
        expect(createTypeNames).toEqual([NEW_ENUM]);
    });

    it('creates only the two new tables and no others', () => {
        expect([...createTableNames].sort()).toEqual([...NEW_TABLES].sort());
    });

    it('creates no table that already exists in Phase 1 / Performance Analytics', () => {
        const collisions = createTableNames.filter((t) =>
            (EXISTING_TABLES as readonly string[]).includes(t),
        );
        expect(collisions).toEqual([]);
    });

    it('creates indexes only on the two new tables', () => {
        const offending = createIndexTargets.filter(
            (t) => !(NEW_TABLES as readonly string[]).includes(t),
        );
        expect(offending).toEqual([]);
    });

    it('creates the expected per-table indexes (unique + lookup on userId)', () => {
        for (const table of NEW_TABLES) {
            const onThisTable = createIndexTargets.filter((t) => t === table);
            // Each new table has a UNIQUE userId index and a userId lookup index.
            expect(onThisTable.length).toBeGreaterThanOrEqual(2);
        }
    });

    it('only ALTERs the new tables, and only to ADD a FOREIGN KEY referencing User', () => {
        // There must be exactly one ADD FOREIGN KEY per new table.
        expect(alterTableStatements.length).toBe(NEW_TABLES.length);

        for (const stmt of alterTableStatements) {
            const target = match1(stmt, /^ALTER TABLE "?([A-Za-z0-9_]+)"?/i);
            expect(target).not.toBeNull();
            // The altered table is a brand-new table, never an existing one.
            expect(NEW_TABLES as readonly string[]).toContain(target!);
            expect(EXISTING_TABLES as readonly string[]).not.toContain(target!);

            // The only permitted alteration is adding a foreign-key constraint...
            expect(/ADD CONSTRAINT .* FOREIGN KEY/i.test(stmt)).toBe(true);
            // ...that references the existing User table (the additive back-relation).
            expect(match1(stmt, /REFERENCES "?([A-Za-z0-9_]+)"?/i)).toBe('User');

            // It must NOT drop, alter, rename, or retype any column/constraint.
            expect(/DROP|ALTER COLUMN|RENAME|ADD COLUMN|TYPE /i.test(stmt)).toBe(false);
        }
    });

    it('alters no existing Phase 1 / Performance Analytics table', () => {
        const alteredExisting = alterTableStatements
            .map((s) => match1(s, /^ALTER TABLE "?([A-Za-z0-9_]+)"?/i))
            .filter((t): t is string => t !== null)
            .filter((t) => (EXISTING_TABLES as readonly string[]).includes(t));
        expect(alteredExisting).toEqual([]);
    });

    it('contains no DROP statement of any kind', () => {
        const drops = allStatements.filter((s) => /\bDROP\b/i.test(s));
        expect(drops).toEqual([]);
    });

    it('never references an existing table as a CREATE/ALTER target column change', () => {
        // Defensive: no statement should rename or retype anything (no existing column touched).
        const mutating = allStatements.filter((s) =>
            /\b(DROP COLUMN|ALTER COLUMN|RENAME (?:COLUMN|TO)|DROP CONSTRAINT)\b/i.test(s),
        );
        expect(mutating).toEqual([]);
    });
});
