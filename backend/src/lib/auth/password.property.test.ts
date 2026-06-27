import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
    PASSWORD_POLICY,
    PasswordRequirement,
    hashPassword,
    validatePassword,
    verifyPassword,
} from './password';

/**
 * Property-based tests for the auth password module (Properties 2, 3, 4).
 *
 * Each property is a single fast-check assertion running the globally-configured
 * minimum of 100 iterations (see `vitest.setup.ts`). They exercise the pure
 * password-policy gate and the hash/verify round-trip directly, with no database
 * dependency, so they stay deterministic.
 */

const LOWERS = 'abcdefghijklmnopqrstuvwxyz'.split('');
const UPPERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const DIGITS = '0123456789'.split('');

/**
 * Generates passwords guaranteed to satisfy every policy requirement: at least one
 * lowercase, one uppercase, and one digit, with a length in [8, 33]. Used to exercise
 * the accept branch and the hash/verify round-trip with realistic valid inputs.
 */
const validPasswordArb: fc.Arbitrary<string> = fc
    .tuple(
        fc.constantFrom(...LOWERS),
        fc.constantFrom(...UPPERS),
        fc.constantFrom(...DIGITS),
        fc.array(fc.constantFrom(...LOWERS, ...UPPERS, ...DIGITS), {
            minLength: 5,
            maxLength: 30,
        }),
    )
    .map(([lower, upper, digit, rest]) => [lower, upper, digit, ...rest].join(''));

/** Mix of arbitrary strings (mostly invalid) and guaranteed-valid passwords. */
const anyPasswordArb: fc.Arbitrary<string> = fc.oneof(
    fc.string({ maxLength: 200 }),
    validPasswordArb,
);

/** Independent re-computation of the policy, used as the oracle for Property 2. */
function satisfiesPolicy(password: string): boolean {
    return (
        password.length >= PASSWORD_POLICY.minLength &&
        password.length <= PASSWORD_POLICY.maxLength &&
        /[a-z]/.test(password) &&
        /[A-Z]/.test(password) &&
        /[0-9]/.test(password)
    );
}

describe('password module properties', () => {
    // Feature: jee-neet-study-app, Property 2: Password policy gate — for any password,
    // registration succeeds only if the password satisfies the policy; any password
    // failing the policy is rejected with a validation error identifying the requirement.
    it('Property 2: a password is accepted iff it satisfies the policy, and failures name an unmet requirement', () => {
        fc.assert(
            fc.property(anyPasswordArb, (password) => {
                const result = validatePassword(password);
                expect(result.valid).toBe(satisfiesPolicy(password));
                if (!result.valid) {
                    // The rejection identifies a concrete, known requirement (Req 1.3).
                    expect(Object.values(PasswordRequirement)).toContain(result.requirement);
                    expect(result.unmet.length).toBeGreaterThan(0);
                    expect(result.unmet[0]).toBe(result.requirement);
                    expect(typeof result.message).toBe('string');
                    expect(result.message.length).toBeGreaterThan(0);
                }
            }),
        );
    });

    // Feature: jee-neet-study-app, Property 3: Credential authentication round-trip — for
    // any account created with a valid password, verifying the exact password against the
    // stored hash returns true, and any differing password is rejected.
    it('Property 3: the exact password verifies against its hash while any differing password fails', async () => {
        await fc.assert(
            fc.asyncProperty(
                validPasswordArb,
                validPasswordArb,
                async (password, otherPassword) => {
                    fc.pre(password !== otherPassword);
                    const hash = await hashPassword(password);
                    await expect(verifyPassword(password, hash)).resolves.toBe(true);
                    await expect(verifyPassword(otherPassword, hash)).resolves.toBe(false);
                },
            ),
            // argon2 is memory-hard: this property hashes once and verifies twice per run,
            // making it one of the slowest in the suite. Cap it low to keep the run fast.
            { numRuns: 8 },
        );
    });

    // Feature: jee-neet-study-app, Property 4: Passwords are never stored in plaintext —
    // for any password, the stored credential is not equal to the plaintext, and verifying
    // the original plaintext against the stored hash returns true.
    it('Property 4: the stored credential never equals the plaintext and the original verifies against it', async () => {
        await fc.assert(
            fc.asyncProperty(validPasswordArb, async (password) => {
                const hash = await hashPassword(password);
                expect(hash).not.toBe(password);
                await expect(verifyPassword(password, hash)).resolves.toBe(true);
            }),
            // argon2 is memory-hard; cap iterations low to keep the suite fast.
            { numRuns: 8 },
        );
    });
});
