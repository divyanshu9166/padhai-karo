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

import { ApiError, fetchMe, getAuthToken, logoutUser, setAuthToken } from '@/api';
import type { PublicUser } from '@/api';

import { clearToken, getToken, setToken } from './tokenStorage';

export type AuthStatus = 'loading' | 'unauthenticated' | 'authenticated' | 'session-unavailable';

interface AuthState {
    status: AuthStatus;
    user: PublicUser | null;
    /** Whether the authenticated user has finished onboarding (Req 2.6). */
    profileComplete: boolean;
    /** A recoverable session-validation problem; never used to silently discard a token. */
    sessionError: string | null;
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
        sessionError: null,
    });

    /** Validate the currently-registered token by loading the session. */
    const loadSession = useCallback(async () => {
        try {
            const me = await fetchMe();
            setState({
                status: 'authenticated',
                user: me.user,
                profileComplete: me.profileComplete,
                sessionError: null,
            });
        } catch (error) {
            if (error instanceof ApiError && error.status === 401) {
                // Only an explicit authentication rejection makes a persisted token invalid.
                setAuthToken(null);
                await clearToken().catch(() => undefined);
                setState({ status: 'unauthenticated', user: null, profileComplete: false, sessionError: null });
                return;
            }

            // A timeout/offline server/5xx is not proof that the credentials expired. Keep
            // the token so a temporary outage cannot lock the learner out of their account.
            setState((previous) => previous.status === 'authenticated'
                ? { ...previous, sessionError: 'Could not refresh your session. Your saved login is still available.' }
                : {
                    status: 'session-unavailable',
                    user: null,
                    profileComplete: false,
                    sessionError: 'Could not connect to verify your saved login. Check your connection and try again.',
                });
        }
    }, []);

    // Startup: load the persisted token, register it, then validate the session.
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const stored = await getToken();
                if (cancelled) return;
                if (!stored) {
                    setState({ status: 'unauthenticated', user: null, profileComplete: false, sessionError: null });
                    return;
                }
                setAuthToken(stored);
                await loadSession();
            } catch {
                if (!cancelled) setState({
                    status: 'session-unavailable',
                    user: null,
                    profileComplete: false,
                    sessionError: 'Could not read your saved login. Try again or sign in again.',
                });
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [loadSession]);

    const refreshSession = useCallback(async () => {
        try {
            let token = getAuthToken();
            if (!token) token = await getToken();
            if (!token) {
                setState({ status: 'unauthenticated', user: null, profileComplete: false, sessionError: null });
                return;
            }
            setAuthToken(token);
            await loadSession();
        } catch {
            setState({
                status: 'session-unavailable',
                user: null,
                profileComplete: false,
                sessionError: 'Could not read your saved login. Try again or sign in again.',
            });
        }
    }, [loadSession]);

    const signIn = useCallback(
        async (token: string) => {
            await setToken(token);
            setAuthToken(token);
            // Resolve onboarding completeness from the server (a new account → false, Req 2.6).
            await loadSession();
        },
        [loadSession],
    );

    const signOut = useCallback(async () => {
        // Capture the authenticated request before clearing the in-memory token, then make
        // local sign-out immediate even if the server cannot be reached.
        const remoteLogout = logoutUser().catch(() => undefined);
        setAuthToken(null);
        await clearToken().catch(() => undefined);
        setState({ status: 'unauthenticated', user: null, profileComplete: false, sessionError: null });
        void remoteLogout;
    }, []);

    const value = useMemo<AuthContextValue>(
        () => ({ ...state, signIn, signOut, refresh: refreshSession }),
        [state, signIn, signOut, refreshSession],
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
