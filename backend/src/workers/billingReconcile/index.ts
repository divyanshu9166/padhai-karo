/**
 * Public surface of the `billing-reconcile` worker (task 16.2, Req 9.5/9.6).
 *
 * The upgrade + compensation logic itself is re-exported from the subscription service
 * (`@/services/subscription`); this module exposes only the BullMQ wiring (worker factory
 * and producer).
 */
export {
    createBillingReconcileWorker,
    enqueueBillingReconcile,
    BILLING_RECONCILE_JOB_NAME,
    type BillingReconcileJobData,
} from './worker';
