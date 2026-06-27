/**
 * The `billing-reconcile` BullMQ worker (task 16.2; design "Background-Job Model",
 * "Payment Failures & Refund-on-Upgrade-Failure"; Req 9.5, 9.6).
 *
 * Thin wiring around the shared {@link runBillingReconcile} function: the actual
 * upgrade-transaction + refund-on-failure logic lives in the subscription service so the
 * request path (`POST /subscriptions/verify`) and this decoupled, retryable worker apply
 * identical semantics. The worker exists so the compensation runs outside the request,
 * with BullMQ retry/backoff, and is idempotent (keyed by payment id).
 *
 * Importing this module opens no Redis connection — the connection is established only
 * when {@link createBillingReconcileWorker} or {@link enqueueBillingReconcile} is invoked.
 */
import { Worker, type Job } from 'bullmq';

import { prisma } from '@/lib/db';
import { getBillingReconcileQueue, getRedisConnection, QUEUE_NAMES } from '@/lib/queue';
import {
    RazorpayHttpGateway,
    runBillingReconcile,
    type RazorpayGateway,
    type ReconcileOutcome,
    type ReconcilePrisma,
} from '@/services/subscription';

/** The job name on the `billing-reconcile` queue. */
export const BILLING_RECONCILE_JOB_NAME = 'reconcile';

/** Payload for a billing-reconcile job: the local `Payment.id` to reconcile. */
export interface BillingReconcileJobData {
    paymentId: string;
}

/**
 * Enqueue a reconciliation job for the given payment. The BullMQ `jobId` is keyed by the
 * payment id so duplicate enqueues collapse to a single job, reinforcing the idempotency
 * that {@link runBillingReconcile} already guarantees.
 */
export async function enqueueBillingReconcile(paymentId: string): Promise<void> {
    await getBillingReconcileQueue().add(
        BILLING_RECONCILE_JOB_NAME,
        { paymentId } satisfies BillingReconcileJobData,
        {
            jobId: `billing-reconcile:${paymentId}`,
            attempts: 5,
            backoff: { type: 'exponential', delay: 1000 },
            removeOnComplete: true,
            removeOnFail: 100,
        },
    );
}

/**
 * Construct the BullMQ worker that consumes the `billing-reconcile` queue, running each job
 * through {@link runBillingReconcile} against the live Prisma client and Razorpay gateway.
 * The gateway is injectable for tests/operator tooling; production uses the live HTTP one.
 */
export function createBillingReconcileWorker(
    gateway: RazorpayGateway = new RazorpayHttpGateway(),
): Worker<BillingReconcileJobData, ReconcileOutcome> {
    return new Worker<BillingReconcileJobData, ReconcileOutcome>(
        QUEUE_NAMES.BILLING_RECONCILE,
        async (job: Job<BillingReconcileJobData>): Promise<ReconcileOutcome> =>
            runBillingReconcile(job.data.paymentId, {
                prisma: prisma as unknown as ReconcilePrisma,
                gateway,
            }),
        { connection: getRedisConnection() },
    );
}
