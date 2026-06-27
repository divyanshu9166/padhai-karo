import { describe, expect, it } from 'vitest';

import {
    SUBSCRIPTION_PLANS,
    getPlan,
    getPlanByAmount,
    isValidPlanId,
    type SubscriptionPlan,
} from './plans';

/**
 * Unit tests for the subscription plan catalog (task 16.2). The catalog is the single
 * source of truth for `plan -> { amount, aiQuota }`, so we pin down its invariants: known
 * ids resolve, unknown ids reject, and amounts are unique (required for the amount->plan
 * reverse lookup the reconciliation relies on).
 */
describe('isValidPlanId', () => {
    it('accepts every catalogued plan id', () => {
        for (const id of Object.keys(SUBSCRIPTION_PLANS)) {
            expect(isValidPlanId(id)).toBe(true);
        }
    });

    it('rejects unknown ids and non-strings', () => {
        expect(isValidPlanId('weekly')).toBe(false);
        expect(isValidPlanId('')).toBe(false);
        expect(isValidPlanId(undefined)).toBe(false);
        expect(isValidPlanId(99)).toBe(false);
        expect(isValidPlanId(null)).toBe(false);
    });
});

describe('getPlan', () => {
    it('resolves a known plan with a positive amount and quota', () => {
        const plan = getPlan('monthly');
        expect(plan).toBeDefined();
        expect((plan as SubscriptionPlan).amount).toBeGreaterThan(0);
        expect((plan as SubscriptionPlan).aiQuota).toBeGreaterThan(0);
    });

    it('returns undefined for an unknown plan', () => {
        expect(getPlan('nope')).toBeUndefined();
    });
});

describe('getPlanByAmount', () => {
    it('recovers each plan from its amount (amounts are unique)', () => {
        const amounts = new Set<number>();
        for (const plan of Object.values(SUBSCRIPTION_PLANS)) {
            expect(amounts.has(plan.amount)).toBe(false);
            amounts.add(plan.amount);
            expect(getPlanByAmount(plan.amount)?.id).toBe(plan.id);
        }
    });

    it('returns undefined when no plan matches the amount', () => {
        expect(getPlanByAmount(1)).toBeUndefined();
    });
});
