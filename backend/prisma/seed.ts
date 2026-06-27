/**
 * Prisma seed script (task 3.1).
 *
 * Idempotently upserts the catalog's Subjects into the database. Subjects are keyed by
 * a stable string id (the catalog `ReferenceSubject.key`, e.g. "JEE-PHYSICS") so that
 * re-running the seed never creates duplicates — an upsert by primary key is a no-op
 * when the row already exists with the same data.
 *
 * Chapters are intentionally NOT seeded here: in the data model a `Chapter` is a
 * per-user instance created at onboarding (task 4.1) from the canonical catalog
 * (see src/lib/reference). The seed therefore only needs to establish the shared,
 * track-keyed Subject rows that those per-user chapters reference.
 *
 * Run with: `npx prisma db seed` (wired via the `prisma.seed` field in package.json).
 * Requires a reachable PostgreSQL instance (DATABASE_URL). The script is safe to run
 * repeatedly.
 */
import { PrismaClient } from '@prisma/client';

import { getAllSubjects } from '../src/lib/reference/catalog';

const prisma = new PrismaClient();

async function seedSubjects(): Promise<number> {
    const subjects = getAllSubjects();

    for (const subject of subjects) {
        // Upsert by stable primary key so the seed is idempotent.
        await prisma.subject.upsert({
            where: { id: subject.key },
            update: { name: subject.name, examTrack: subject.examTrack },
            create: { id: subject.key, name: subject.name, examTrack: subject.examTrack },
        });
    }

    return subjects.length;
}

async function main(): Promise<void> {
    const count = await seedSubjects();
    // eslint-disable-next-line no-console
    console.log(`Seed complete: upserted ${count} subjects.`);
}

main()
    .catch((error) => {
        // eslint-disable-next-line no-console
        console.error('Seed failed:', error);
        process.exitCode = 1;
    })
    .finally(() => {
        void prisma.$disconnect();
    });
