/**
 * Public surface of the subscription service (task 16.2, Req 9.5/9.6).
 *
 * Re-exports the request handlers, the reusable upgrade+compensation function (shared with
 * the `billing-reconcile` worker), the plan catalog, the Razorpay gateway seam, and the
 * pure signature helpers (shared with the webhook endpoint, task 16.3).
 */
export {
    createOrderHandler,
    verifyPaymentHandler,
    getSubscriptionHandler,
} from './subscriptionService';

export {
    handleRazorpayWebhook,
    razorpayWebhookHandler,
    type WebhookDeps,
    type WebhookPaymentRow,
    type WebhookPrisma,
} from './webhookService';

export {
    runBillingReconcile,
    type ReconcileDeps,
    type ReconcileOutcome,
    type ReconcilePaymentRow,
    type ReconcilePrisma,
    type ReconcileTx,
} from './reconcile';

export {
    SUBSCRIPTION_PLANS,
    getPlan,
    getPlanByAmount,
    isValidPlanId,
    type SubscriptionPlan,
    type SubscriptionPlanId,
} from './plans';

export {
    computeHmacSha256,
    safeSignatureEqual,
    verifyHmacSignature,
    verifyPaymentSignature,
    type PaymentSignatureInput,
} from './signature';

export { RazorpayHttpGateway } from './razorpayGateway';
export type {
    CreateOrderInput,
    RazorpayGateway,
    RazorpayOrder,
    RazorpayRefund,
    RefundInput,
    VerifyPaymentSignatureInput,
} from './types';
