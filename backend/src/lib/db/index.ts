/**
 * Prisma client singleton.
 *
 * A single `PrismaClient` instance is shared across the server process. In development
 * Next.js hot-reloads modules, which would otherwise spawn a new client (and a new
 * connection pool) on every reload and exhaust database connections; stashing the
 * instance on `globalThis` keeps exactly one client across reloads.
 *
 * Construction is lazy with respect to the database: `new PrismaClient()` does NOT open
 * a connection — Prisma connects on the first query. That means importing this module
 * (and running the test suite) does not require a live PostgreSQL instance. The
 * `DATABASE_URL` datasource is configured in `prisma/schema.prisma` (task 1.2); the full
 * model set and initial migration land in task 1.3.
 */
import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as {
    prisma: PrismaClient | undefined;
};

export const prisma: PrismaClient =
    globalForPrisma.prisma ??
    new PrismaClient({
        log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
    });

if (process.env.NODE_ENV !== 'production') {
    globalForPrisma.prisma = prisma;
}

export default prisma;
