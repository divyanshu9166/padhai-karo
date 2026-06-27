/**
 * Auth / session state (task 21.1, Req 1, 2.6).
 *
 * Holds the current user + session token and drives onboarding-gated routing. On startup it
 * loads any persisted token from secure storage ({@link getToken}), registers it with the API
 * client ({@link setAuthToken}), and validates it via `GET /auth/me`, which also returns
 * `profileComplete` — the signal that decides whether an authenticated user still needs
 * onboarding (Req 2.6).
 *
 * State machine (`status`):
 *   - `loading`         — booting: reading the stored token / validating the session.
 *   - `unauthenticated` — no valid token; the navigator shows the auth screens.
 *   - `authenticated`   — valid session; combined with `profileComplete` the navigator shows
 *                         either the onboarding flow (`profileComplete === false`) or the main
 *                         app (`profileComplete === true`).
 */
import React, {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useState,
} from 'react';

import { fetchMe, logoutUser, setAuthToken } from '@/api';
import type { PublicUser } from '@/api';

import { clearToken, getToken, setToken } from './tokenStorage';

export type AuthStatus = 'loading' | 'unauthenticated' | 'authenticated';

interface AuthState {
    status: AuthStatus;
    user: PublicUser | null;
    /** Whether the authenticated user has finished onboarding (Req 2.6). */
    profileComplete: boolean;
}

interface AuthContextValue extends AuthState {
    /**
     * Complete a sign-in: persist + register the token, then validate the session via
     * `/auth/me` to resolve the user and onboarding completeness. Used by the login/register
     * screens after a successful auth call (Req 1.1, 1.4).
     */
    signIn(token: string, user: PublicUser): Promise<void>;
    /** Sign out: clear the stored token and reset to unauthenticated. */
    signOut(): Promise<void>;
    /** Re-fetch `/auth/me` to refresh the user + onboarding completeness (Req 2.6). */
    refresh(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

interface AuthProviderProps {
    children: React.ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps): React.JSX.Element {
    const [state, setState] = useState<AuthState>({
        status: 'loading',
        user: null,
        profileComplete: false,
    });

    /** Validate the currently-registered token by loading the session. */
    const loadSession = useCallback(async () => {
        try {
            const me = await fetchMe();
            setState({
                status: 'authenticated',
                user: me.user,
                profileComplete: me.profileComplete,
            });
        } catch {
            // Invalid/expired token: drop it and fall back to unauthenticated.
            setAuthToken(null);
            await clearToken();
            setState({ status: 'unauthenticated', user: null, profileComplete: false });
        }
    }, []);

    // Startup: load the persisted token, register it, then validate the session.
    useEffect(() => {
        let cancelled = false;
        (async () => {
            const stored = await getToken();
            if (cancelled) {
                return;
            }
            if (!stored) {
                setState({ status: 'unauthenticated', user: null, profileComplete: false });
                return;
            }
            setAuthToken(stored);
            await loadSession();
        })();
        return () => {
            cancelled = true;
        };
    }, [loadSession]);

    const signIn = useCallback(
        async (token: string) => {
            setAuthToken(token);
            await setToken(token);
            // Resolve onboarding completeness from the server (a new account → false, Req 2.6).
            await loadSession();
        },
        [loadSession],
    );

    const signOut = useCallback(async () => {
        try {
            await logoutUser();
        } catch {
            // Best-effort server logout; clear local state regardless.
        }
        setAuthToken(null);
        await clearToken();
        setState({ status: 'unauthenticated', user: null, profileComplete: false });
    }, []);

    const value = useMemo<AuthContextValue>(
        () => ({ ...state, signIn, signOut, refresh: loadSession }),
        [state, signIn, signOut, loadSession],
    );

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** Access auth/session state and actions. Must be used under an {@link AuthProvider}. */
export function useAuth(): AuthContextValue {
    const ctx = useContext(AuthContext);
    if (ctx === undefined) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return ctx;
}
