import { describe, expect, it } from 'vitest';

import { runNtaIngestion, type NtaIngestionPrisma } from './worker';
import type { NtaSource, RawNtaItem } from './types';

/** A fixture source returning a fixed batch (no network). */
function fixtureSource(items: RawNtaItem[]): NtaSource {
    return { fetchAnnouncements: async () => items };
}

interface StoredAnnouncement {
    id: string;
    examScope: string;
    title: string;
    body: string;
    publishedAt: Date;
    dedupeHash: string;
    affectsExamDate: boolean;
    newExamDate: Date | null;
}

interface StoredProfile {
    userId: string;
    examTrack: 'JEE' | 'NEET';
    revisionBufferDays: number;
    targetExamDate: Date | null;
}

/** A minimal in-memory Prisma mock satisfying {@link NtaIngestionPrisma}. */
function mockPrisma(profiles: StoredProfile[] = []) {
    const announcements: StoredAnnouncement[] = [];
    let seq = 0;
    const prisma: NtaIngestionPrisma = {
        nTAAnnouncement: {
            findUnique: async ({ where }) =>
                announcements.find((a) => a.dedupeHash === where.dedupeHash) ?? null,
            create: async ({ data }) => {
                const row: StoredAnnouncement = { id: `a${seq++}`, ...data };
                announcements.push(row);
                return { id: row.id };
            },
        },
        profile: {
            findMany: async ({ where }) =>
                profiles
                    .filter((p) => p.examTrack === where.examTrack)
                    .map((p) => ({ userId: p.userId, revisionBufferDays: p.revisionBufferDays })),
            update: async ({ where, data }) => {
                const profile = profiles.find((p) => p.userId === where.userId);
                if (profile) profile.targetExamDate = data.targetExamDate;
                return profile;
            },
        },
    };
    return { prisma, announcements, profiles };
}

const validItem: RawNtaItem = {
    examScope: 'JEE_MAIN',
    title: 'JEE Main session 2 schedule',
    body: 'Session 2 will be held in April.',
    publishedAt: '2025-03-01T08:00:00.000Z',
};

describe('runNtaIngestion', () => {
    it('stores valid items with sanitized content', async () => {
        const { prisma, announcements } = mockPrisma();
        const result = await runNtaIngestion(
            fixtureSource([{ ...validItem, body: '<p>Session 2 will be held soon in <b>April</b></p>' }]),
            { prisma },
        );

        expect(result.stored).toBe(1);
        expect(result.fetched).toBe(1);
        expect(announcements).toHaveLength(1);
        expect(announcements[0].body).toBe('Session 2 will be held soon in April');
        expect(announcements[0].body).not.toMatch(/[<>]/);
    });

    it('skips malformed items without failing the batch', async () => {
        const { prisma, announcements } = mockPrisma();
        const result = await runNtaIngestion(
            fixtureSource([
                validItem,
                { examScope: 'UNKNOWN', title: 'x', body: 'y', publishedAt: 'nope' },
                { title: 'no scope', body: 'b', publishedAt: '2025-03-01T00:00:00Z' },
            ]),
            { prisma },
        );

        expect(result.fetched).toBe(3);
        expect(result.stored).toBe(1);
        expect(result.skippedMalformed).toBe(2);
        expect(announcements).toHaveLength(1);
    });

    it('de-duplicates identical items within a batch', async () => {
        const { prisma, announcements } = mockPrisma();
        const result = await runNtaIngestion(
            fixtureSource([validItem, { ...validItem }, { ...validItem }]),
            { prisma },
        );

        expect(result.stored).toBe(1);
        expect(result.duplicates).toBe(2);
        expect(announcements).toHaveLength(1);
    });

    it('is idempotent across runs (re-ingesting stores nothing new)', async () => {
        const { prisma, announcements } = mockPrisma();
        await runNtaIngestion(fixtureSource([validItem]), { prisma });
        const second = await runNtaIngestion(fixtureSource([validItem]), { prisma });

        expect(second.stored).toBe(0);
        expect(second.duplicates).toBe(1);
        expect(announcements).toHaveLength(1);
    });

    it('propagates an exam-date change to affected users of the matching track', async () => {
        const { prisma, profiles } = mockPrisma([
            { userId: 'jee1', examTrack: 'JEE', revisionBufferDays: 45, targetExamDate: null },
            { userId: 'jee2', examTrack: 'JEE', revisionBufferDays: 30, targetExamDate: null },
            { userId: 'neet1', examTrack: 'NEET', revisionBufferDays: 45, targetExamDate: null },
        ]);
        const now = new Date('2026-01-01T00:00:00.000Z');
        const result = await runNtaIngestion(
            fixtureSource([
                {
                    examScope: 'JEE_ADVANCED',
                    title: 'JEE Advanced 2026 date revised',
                    body: 'The exam has been rescheduled.',
                    publishedAt: '2025-12-01T00:00:00.000Z',
                    affectsExamDate: true,
                    newExamDate: '2026-05-24T00:00:00.000Z',
                },
            ]),
            { prisma, now },
        );

        // Only the two JEE-track users are updated; the NEET user is untouched.
        expect(result.examDateUpdates.map((u) => u.userId).sort()).toEqual(['jee1', 'jee2']);
        const newExam = new Date('2026-05-24T00:00:00.000Z');
        expect(profiles.find((p) => p.userId === 'jee1')?.targetExamDate?.toISOString()).toBe(
            newExam.toISOString(),
        );
        expect(profiles.find((p) => p.userId === 'neet1')?.targetExamDate).toBeNull();

        const jee1 = result.examDateUpdates.find((u) => u.userId === 'jee1');
        // Target_Completion_Date = newExamDate - 45 days.
        expect(jee1?.targetCompletionDate.toISOString()).toBe('2026-04-09T00:00:00.000Z');
    });

    it('does not propagate exam dates for non-exam-date announcements', async () => {
        const { prisma } = mockPrisma([
            { userId: 'jee1', examTrack: 'JEE', revisionBufferDays: 45, targetExamDate: null },
        ]);
        const result = await runNtaIngestion(fixtureSource([validItem]), { prisma });
        expect(result.examDateUpdates).toEqual([]);
    });
});
