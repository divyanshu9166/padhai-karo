/**
 * Redis connection + BullMQ queue registration.
 *
 * Per design "Background-Job Model", Redis + BullMQ host exactly three queues:
 *   - `pyq-extraction`   — AI-vision PYQ extraction pipeline (worker in task 12).
 *   - `nta-ingestion`    — repeatable NTA announcement ingestion (worker in task 17).
 *   - `billing-reconcile`— post-payment upgrade / refund compensation (worker in task 16).
 *
 * This module establishes the shared connection and the queue producers only. Worker
 * (consumer) logic is intentionally NOT implemented here — it lands in the tasks above.
 *
 * Everything is created lazily: the ioredis connection uses `lazyConnect`, and queues
 * are constructed on first access and memoized. Importing this module therefore opens no
 * sockets, so the test suite and a `next build` run without a live Redis instance.
 */
import { Queue } from 'bullmq';
import IORedis, { type Redis } from 'ioredis';

import { getConfig } from '@/lib/config';

/** The three queue names from the design "Background-Job Model". */
export const QUEUE_NAMES = {
    PYQ_EXTRACTION: 'pyq-extraction',
    NTA_INGESTION: 'nta-ingestion',
    BILLING_RECONCILE: 'billing-reconcile',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

let connection: Redis | undefined;
const queues = new Map<QueueName, Queue>();

/**
 * Returns the shared ioredis connection used by every queue (and, later, every worker).
 *
 * `maxRetriesPerRequest: null` is required by BullMQ for blocking commands.
 * `lazyConnect: true` defers the actual TCP connection until the first command, keeping
 * module import side-effect free.
 */
export function getRedisConnection(): Redis {
    if (connection === undefined) {
        const { redisUrl } = getConfig();
        connection = new IORedis(redisUrl, {
            maxRetriesPerRequest: null,
            lazyConnect: true,
        });
    }
    return connection;
}

/**
 * Returns the BullMQ queue for the given name, constructing and memoizing it on first
 * use so all producers share one instance (and one connection).
 */
export function getQueue(name: QueueName): Queue {
    let queue = queues.get(name);
    if (queue === undefined) {
        queue = new Queue(name, { connection: getRedisConnection() });
        queues.set(name, queue);
    }
    return queue;
}

/** The `pyq-extraction` queue producer (Req 7). */
export function getPyqExtractionQueue(): Queue {
    return getQueue(QUEUE_NAMES.PYQ_EXTRACTION);
}

/** The `nta-ingestion` queue producer (Req 20). */
export function getNtaIngestionQueue(): Queue {
    return getQueue(QUEUE_NAMES.NTA_INGESTION);
}

/** The `billing-reconcile` queue producer (Req 9.6). */
export function getBillingReconcileQueue(): Queue {
    return getQueue(QUEUE_NAMES.BILLING_RECONCILE);
}

/**
 * Gracefully closes every constructed queue and the shared connection. Intended for
 * worker/process shutdown hooks and tests. Safe to call when nothing was created.
 */
export async function closeQueues(): Promise<void> {
    await Promise.all([...queues.values()].map((queue) => queue.close()));
    queues.clear();
    if (connection !== undefined) {
        connection.disconnect();
        connection = undefined;
    }
}
