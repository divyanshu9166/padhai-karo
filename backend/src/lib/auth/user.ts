/**
 * Safe, client-facing projection of a {@link User}.
 *
 * The `User` row carries `passwordHash`, which MUST never leave the server (Req 1.6).
 * Every endpoint that returns user data shapes it through {@link toPublicUser} so the
 * sensitive columns are dropped at a single, auditable choke point — there is no path
 * by which a handler can accidentally serialize the full row.
 */
import type { User } from '@prisma/client';

/** The only user fields exposed to clients. */
export interface PublicUser {
    id: string;
    email: string;
    createdAt: Date;
}

/**
 * Project a persisted {@link User} down to its client-safe fields. Never includes
 * `passwordHash` or any other sensitive column.
 */
export function toPublicUser(user: Pick<User, 'id' | 'email' | 'createdAt'>): PublicUser {
    return {
        id: user.id,
        email: user.email,
        createdAt: user.createdAt,
    };
}
