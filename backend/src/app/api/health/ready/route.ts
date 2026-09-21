import { prisma } from '@/lib/db';
import { getRedisConnection } from '@/lib/queue';

/**
 * Dependency readiness probe for Docker, reverse proxies, and VPS monitoring.
 * `/api/health` remains a cheap liveness/capability probe; this endpoint verifies that
 * the application can actually reach both stateful services before receiving traffic.
 */
export async function GET(): Promise<Response> {
    const [database, redis] = await Promise.allSettled([
        prisma.$queryRaw`SELECT 1`,
        getRedisConnection().ping(),
    ]);

    const ready = database.status === 'fulfilled' && redis.status === 'fulfilled';
    return Response.json(
        {
            status: ready ? 'ready' : 'not_ready',
            service: 'padhai-karo-backend',
            checks: {
                database: database.status === 'fulfilled' ? 'ok' : 'unavailable',
                redis: redis.status === 'fulfilled' ? 'ok' : 'unavailable',
            },
        },
        { status: ready ? 200 : 503 },
    );
}
