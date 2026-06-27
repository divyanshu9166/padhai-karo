/**
 * Subscription plan catalog (task 16.2; design "Monetization / Subscription Service",
 * Req 9.5).
 *
 * The single source of truth for the `plan -> { amount, aiQuota }` mapping. Both the
 * order endpoint (which charges `amount`) and the upgrade transaction (which allocates
 * `aiQuota` on success — Req 9.5) read from here so the price a user pays and the quota
 * they receive can never drift apart.
 *
 * `amount` is expressed in the smallest currency unit (paise for INR), matching the unit
 * Razorpay expects and the `Payment.amount` integer column. Amounts are unique per plan so
 * a captured payment can be mapped back to its plan from the stored `Payment.amount`
 * (see {@link getPlanByAmount}); this lets the decoupled `billing-reconcile` worker resolve
 * the quota to allocate from the payment row alone, without a separate plan column.
 */

/** A purchasable subscription plan. */
export interface SubscriptionPlan {
    /** Stable plan identifier accepted by `POST /subscriptions/order`. */
    id: SubscriptionPlanId;
    /** Charge amount in the smallest currency unit (paise for INR). */
    amount: number;
    /** AI usage quota allocated to the user's profile when the upgrade succeeds (Req 9.5). */
    aiQuota: number;
    /** ISO 4217 currency code. Razorpay orders are created in this currency. */
    currency: 'INR';
}

/** The set of valid plan identifiers. */
export type SubscriptionPlanId = 'monthly' | 'quarterly' | 'annual';

/**
 * The plan catalog keyed by id. Amounts are in paise and MUST stay unique across plans so
 * {@link getPlanByAmount} can recover the plan from a captured payment's amount.
 */
export const SUBSCRIPTION_PLANS: Readonly<Record<SubscriptionPlanId, SubscriptionPlan>> = {
    monthly: { id: 'monthly', amount: 9900, aiQuota: 100, currency: 'INR' },
    quarterly: { id: 'quarterly', amount: 24900, aiQuota: 350, currency: 'INR' },
    annual: { id: 'annual', amount: 79900, aiQuota: 1500, currency: 'INR' },
} as const;

/** Narrow an arbitrary value to a known plan id. */
export function isValidPlanId(value: unknown): value is SubscriptionPlanId {
    return typeof value === 'string' && Object.prototype.hasOwnProperty.call(SUBSCRIPTION_PLANS, value);
}

/** Resolve a plan by id, or `undefined` if the id is unknown. */
export function getPlan(planId: unknown): SubscriptionPlan | undefined {
    return isValidPlanId(planId) ? SUBSCRIPTION_PLANS[planId] : undefined;
}

/**
 * Recover the plan that a captured payment paid for, by its `amount`. Used by the
 * upgrade/compensation path so the quota allocated on success is derived solely from the
 * persisted payment, keeping the `billing-reconcile` worker self-contained. Returns
 * `undefined` if no plan matches (the upgrade cannot proceed and the payment is refunded).
 */
export function getPlanByAmount(amount: number): SubscriptionPlan | undefined {
    return Object.values(SUBSCRIPTION_PLANS).find((plan) => plan.amount === amount);
}
