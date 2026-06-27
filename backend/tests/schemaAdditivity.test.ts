import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * Schema-additivity test for the Phase 2 Performance Analytics migration (Task 1.7).
 *
 * Req 13.1 / 13.3 mandate that Phase 2 reuses the persisted Phase 1 data and stores any
 * new data in ADDITIVE models/columns, leaving every Phase 1 model and column unchanged.
 * Task 1.1 added only new enums/models plus two virtual back-relation fields on `User`
 * (no column change). This is a pure file-content / static check over the generated
 * migration SQL — it reads the migration via `fs` and asserts the migration contains ONLY
 * additive statements and NO destructive/altering statements against any Phase 1 table.
 *
 * Validates: Requirements 13.1, 13.3
 */

const MIGRATION_PATH = fileURLToPath(
    new URL(
        '../prisma/migrations/20260627120636_add_performance_analytics/migration.sql',
        import.meta.url,
    ),
);

/** The six new (additive) tables this migration is allowed to create / alter. */
const NEW_TABLES = [
    'ExternalMockScore',
    'TargetCollegeCutoffSelection',
    'QuestionTopicMap',
    'CutoffReferenceData',
    'ScoreStandingMap',
    'TopicFrequencyReferenceData',
] as const;

/**
 * Every Phase 1 table from the init migration. Phase 2 must not DROP, add/remove/alter a
 * column on, or otherwise mutate any of these.
 */
const PHASE_1_TABLES = [
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
] as const;

const NEW_TABLE_SET = new Set<string>(NEW_TABLES);

/** Read the migration file and split it into individual, comment-free SQL statements. */
function readStatements(): string[] {
    const raw = readFileSync(MIGRATION_PATH, 'utf8');
    return raw
        .split('\n')
        // Drop full-line SQL comments (`-- CreateTable`, etc.).
        .filter((line) => !line.trimStart().startsWith('--'))
        .join('\n')
        .split(';')
        // Collapse internal whitespace/newlines so each statement is single-line.
        .map((stmt) => stmt.replace(/\s+/g, ' ').trim())
        .filter((stmt) => stmt.length > 0);
}

const statements = readStatements();

describe('Phase 2 migration is additive (Req 13.1, 13.3)', () => {
    it('contains only additive statement types (CREATE TYPE/TABLE/INDEX, ALTER TABLE ADD CONSTRAINT ... FOREIGN KEY)', () => {
        const allowed = [
            /^CREATE TYPE /i,
            /^CREATE TABLE /i,
            /^CREATE INDEX /i,
            /^CREATE UNIQUE INDEX /i,
            /^ALTER TABLE "\w+" ADD CONSTRAINT "[^"]+" FOREIGN KEY /i,
        ];

        for (const stmt of statements) {
            const isAllowed = allowed.some((pattern) => pattern.test(stmt));
            expect(isAllowed, `Non-additive statement found: ${stmt}`).toBe(true);
        }
    });

    it('contains no destructive DROP statements', () => {
        for (const stmt of statements) {
            expect(/\bDROP\b/i.test(stmt), `Unexpected DROP statement: ${stmt}`).toBe(false);
        }
    });

    it('contains no column additions, removals, or type changes on any table', () => {
        for (const stmt of statements) {
            expect(/ADD COLUMN/i.test(stmt), `Unexpected ADD COLUMN: ${stmt}`).toBe(false);
            expect(/DROP COLUMN/i.test(stmt), `Unexpected DROP COLUMN: ${stmt}`).toBe(false);
            expect(/ALTER COLUMN/i.test(stmt), `Unexpected ALTER COLUMN: ${stmt}`).toBe(false);
        }
    });

    it('does not ADD COLUMN, DROP, or otherwise alter any Phase 1 table', () => {
        const alterMatches = statements
            .map((stmt) => /^ALTER TABLE "(\w+)"/i.exec(stmt))
            .filter((m): m is RegExpExecArray => m !== null);

        for (const match of alterMatches) {
            const table = match[1];
            // Every ALTER TABLE in this migration must target a NEW table only.
            expect(
                NEW_TABLE_SET.has(table),
                `ALTER TABLE targets a non-new table "${table}": ${match.input}`,
            ).toBe(true);
        }

        // Explicitly assert no Phase 1 table is the subject of any ALTER/DROP statement.
        for (const table of PHASE_1_TABLES) {
            const offending = statements.filter((stmt) =>
                new RegExp(`^(ALTER TABLE|DROP TABLE) "${table}"`, 'i').test(stmt),
            );
            expect(
                offending,
                `Phase 1 table "${table}" must not be altered or dropped`,
            ).toEqual([]);
        }

        // Spot-check the back-relation-only models called out by the task: `User` gets two
        // virtual Prisma back-relations (ExternalMockScore, TargetCollegeCutoffSelection)
        // which produce NO SQL column change, so `User` must never appear in an ALTER.
        const userAlters = statements.filter((stmt) => /^ALTER TABLE "User"/i.test(stmt));
        expect(userAlters, 'User must not be altered (back-relations are virtual)').toEqual([]);
    });

    it('creates exactly the six new analytics tables and no others', () => {
        const created = statements
            .map((stmt) => /^CREATE TABLE "(\w+)"/i.exec(stmt))
            .filter((m): m is RegExpExecArray => m !== null)
            .map((m) => m[1])
            .sort();

        expect(created).toEqual([...NEW_TABLES].sort());
    });

    it('only adds foreign keys onto the new tables', () => {
        const fkTargets = statements
            .map((stmt) => /^ALTER TABLE "(\w+)" ADD CONSTRAINT .* FOREIGN KEY/i.exec(stmt))
            .filter((m): m is RegExpExecArray => m !== null)
            .map((m) => m[1]);

        // There is at least one FK in this migration, and every one is on a new table.
        expect(fkTargets.length).toBeGreaterThan(0);
        for (const table of fkTargets) {
            expect(NEW_TABLE_SET.has(table), `FK added to non-new table "${table}"`).toBe(true);
        }
    });
});
