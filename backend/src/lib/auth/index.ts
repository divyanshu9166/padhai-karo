export {
    ARGON2_PARAMS,
    PASSWORD_POLICY,
    PASSWORD_REQUIREMENT_MESSAGES,
    PasswordRequirement,
    hashPassword,
    validatePassword,
    verifyPassword,
} from './password';
export type { PasswordPolicyResult } from './password';

export {
    SESSION_TTL_MS,
    createSession,
    extractBearerToken,
    generateSessionToken,
    hashSessionToken,
    resolveSession,
    revokeSession,
} from './session';
export type { IssuedSession, ResolvedSession } from './session';

export {
    ForbiddenError,
    assertOwnership,
    forbiddenResponse,
    ownsResource,
    unauthorizedResponse,
    withAuth,
} from './guard';
export type { AuthContext, AuthenticatedRouteHandler } from './guard';

export { toPublicUser } from './user';
export type { PublicUser } from './user';

export { isValidEmail, normalizeEmail } from './email';

export {
    LOGIN_ATTEMPTS_PER_IP,
    LOGIN_FAILURES_PER_EMAIL,
    MemoryRateLimitStore,
    REGISTER_PER_IP,
    RESET_ATTEMPTS_PER_IP,
    RESET_REQUESTS_PER_EMAIL,
    clearAttempts,
    clientAddress,
    consumeAttempt,
    recordAttempt,
    retryAfterSec,
    setRateLimitStore,
    tooManyAttemptsResponse,
} from './rateLimit';
export type { RateLimitRule, RateLimitStore } from './rateLimit';
