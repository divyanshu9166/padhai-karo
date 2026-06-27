/**
 * Password hashing and password-policy validation (Req 1.3, 1.6).
 *
 * Hashing uses **argon2id**, the memory-hard algorithm preferred by the design
 * ("Security Considerations: Password Storage & Authentication"). The implementation
 * is `hash-wasm`, a pure-WebAssembly build of argon2 that needs no native toolchain,
 * so it installs and runs reliably across deployment and CI environments where a
 * native binding might fail to compile.
 *
 * Each password is hashed with a fresh random 16-byte salt (Req 1.6: unique salt per
 * password). The produced value is a self-describing PHC-format string
 * (`$argon2id$v=19$m=...,t=...,p=...$<salt>$<hash>`) that embeds the algorithm
 * parameters and salt, so {@link verifyPassword} needs only the stored string to
 * re-derive and compare. Verification delegates to argon2's constant-time comparison
 * to avoid timing side-channels.
 */
import { randomBytes } from 'node:crypto';

import { argon2id, argon2Verify } from 'hash-wasm';

/**
 * argon2id cost parameters. These follow the OWASP-recommended baseline for argon2id
 * (memory 19 MiB, 2 iterations, parallelism 1) and are tuned for the deployment per the
 * design. They are exported so they can be referenced/adjusted from one place.
 */
export const ARGON2_PARAMS = {
    /** Memory cost in KiB (19456 KiB = 19 MiB). */
    memorySize: 19456,
    /** Number of passes over memory. */
    iterations: 2,
    /** Degree of parallelism. */
    parallelism: 1,
    /** Length of the derived hash in bytes. */
    hashLength: 32,
    /** Length of the per-password random salt in bytes. */
    saltLength: 16,
} as const;

/**
 * Stable identifiers for each individual password-policy requirement. These are
 * surfaced in the validation `details` so the API can return a `422` that names the
 * specific unmet requirement (Req 1.3), and the client can localize the message.
 */
export const PasswordRequirement = {
    MIN_LENGTH: 'MIN_LENGTH',
    MAX_LENGTH: 'MAX_LENGTH',
    LOWERCASE: 'LOWERCASE',
    UPPERCASE: 'UPPERCASE',
    DIGIT: 'DIGIT',
} as const;

export type PasswordRequirement = (typeof PasswordRequirement)[keyof typeof PasswordRequirement];

/**
 * The password policy enforced at registration. Chosen as a reasonable baseline:
 * a minimum length of 8 with a character mix (at least one lowercase letter, one
 * uppercase letter, and one digit). A maximum length guards against denial-of-service
 * via very long inputs to the memory-hard hash.
 */
export const PASSWORD_POLICY = {
    minLength: 8,
    maxLength: 128,
    requireLowercase: true,
    requireUppercase: true,
    requireDigit: true,
} as const;

/** Human-readable description of each requirement, keyed by its stable identifier. */
export const PASSWORD_REQUIREMENT_MESSAGES: Record<PasswordRequirement, string> = {
    [PasswordRequirement.MIN_LENGTH]: `Password must be at least ${PASSWORD_POLICY.minLength} characters long.`,
    [PasswordRequirement.MAX_LENGTH]: `Password must be at most ${PASSWORD_POLICY.maxLength} characters long.`,
    [PasswordRequirement.LOWERCASE]: 'Password must contain at least one lowercase letter.',
    [PasswordRequirement.UPPERCASE]: 'Password must contain at least one uppercase letter.',
    [PasswordRequirement.DIGIT]: 'Password must contain at least one digit.',
};

/** Result of evaluating a password against {@link PASSWORD_POLICY}. */
export type PasswordPolicyResult =
    | { valid: true }
    | {
        valid: false;
        /** The first unmet requirement, used as the primary signal for the API. */
        requirement: PasswordRequirement;
        /** Developer-facing message for the primary unmet requirement. */
        message: string;
        /** Every requirement the password failed, in evaluation order. */
        unmet: PasswordRequirement[];
    };

/**
 * Evaluate a password against the policy, collecting every unmet requirement in a
 * fixed evaluation order. Returns `{ valid: true }` when all requirements pass;
 * otherwise returns the first failed requirement (for a precise single-requirement
 * error message) along with the full list of failures.
 *
 * Evaluation is pure and performs no hashing, so it is cheap to call before the
 * memory-hard hash on the registration path.
 */
export function validatePassword(password: string): PasswordPolicyResult {
    const unmet: PasswordRequirement[] = [];

    if (password.length < PASSWORD_POLICY.minLength) {
        unmet.push(PasswordRequirement.MIN_LENGTH);
    }
    if (password.length > PASSWORD_POLICY.maxLength) {
        unmet.push(PasswordRequirement.MAX_LENGTH);
    }
    if (PASSWORD_POLICY.requireLowercase && !/[a-z]/.test(password)) {
        unmet.push(PasswordRequirement.LOWERCASE);
    }
    if (PASSWORD_POLICY.requireUppercase && !/[A-Z]/.test(password)) {
        unmet.push(PasswordRequirement.UPPERCASE);
    }
    if (PASSWORD_POLICY.requireDigit && !/[0-9]/.test(password)) {
        unmet.push(PasswordRequirement.DIGIT);
    }

    if (unmet.length === 0) {
        return { valid: true };
    }

    const requirement = unmet[0];
    return {
        valid: false,
        requirement,
        message: PASSWORD_REQUIREMENT_MESSAGES[requirement],
        unmet,
    };
}

/**
 * Hash a plaintext password with argon2id and a fresh random salt (Req 1.6).
 *
 * @returns a PHC-format encoded string embedding the algorithm parameters, the
 * unique salt, and the derived hash. Store this value directly; never store or log
 * the plaintext.
 */
export async function hashPassword(password: string): Promise<string> {
    const salt = randomBytes(ARGON2_PARAMS.saltLength);
    return argon2id({
        password,
        salt,
        parallelism: ARGON2_PARAMS.parallelism,
        iterations: ARGON2_PARAMS.iterations,
        memorySize: ARGON2_PARAMS.memorySize,
        hashLength: ARGON2_PARAMS.hashLength,
        outputType: 'encoded',
    });
}

/**
 * Verify a plaintext password against a stored argon2id hash using argon2's
 * constant-time comparison (avoids timing side-channels per the design).
 *
 * Returns `false` for a non-matching password and also for a malformed/empty stored
 * hash, so callers get a uniform boolean and authentication never throws on bad data.
 */
export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
    if (!storedHash) {
        return false;
    }
    try {
        return await argon2Verify({ password, hash: storedHash });
    } catch {
        // A malformed/unrecognized stored hash cannot match any password.
        return false;
    }
}
