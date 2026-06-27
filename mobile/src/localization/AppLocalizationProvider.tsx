/**
 * App-level localization wiring (task 21.8; Req 10.1/10.2/10.3/10.4).
 *
 * Bridges the User's stored Language_Preference to the pure {@link LocalizationProvider}:
 *
 *   - On authentication it reads the stored preference from the User profile
 *     (`GET /profile` via {@link fetchProfileLanguage}) so rendered text honors the stored
 *     Language_Preference, overriding the device locale (Req 10.2). When no preference is
 *     stored yet (pre-onboarding / fetch failure) it falls back to English (Req 10.3).
 *   - It exposes a `setLanguage` callback (consumed by the {@link LanguageToggle}) that applies
 *     the new language immediately — driving `t()` app-wide live — and persists it via
 *     `PATCH /profile/language` ({@link updateProfileLanguage}, Req 10.1). A failed persist
 *     reverts the in-memory language so the UI never drifts from the stored value.
 *   - On sign-out it resets to English so the next user starts from the default (Req 10.3).
 *
 * EN and HI are the only languages the System supports (Req 10.4); the stored value maps
 * directly onto a catalog lookup with no translation layer.
 *
 * This component is the only localization piece coupled to auth/network; the provider it wraps
 * stays pure and controlled. It must be mounted under both the AuthProvider (it reads session
 * status) and inside the API client's auth context (the requests carry the session token).
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';

import { fetchProfileLanguage, updateProfileLanguage } from '@/api';
import { useAuth } from '@/state';

import { LocalizationProvider } from './LocalizationContext';
import { resolveStoredLanguage } from './preference';
import { DEFAULT_LANGUAGE, type Language } from './types';

interface AppLocalizationProviderProps {
    children: React.ReactNode;
}

export function AppLocalizationProvider({
    children,
}: AppLocalizationProviderProps): React.JSX.Element {
    const { status } = useAuth();
    const [language, setLanguageState] = useState<Language>(DEFAULT_LANGUAGE);

    // Mirror the active language in a ref so `setLanguage` can read/restore it without
    // depending on the latest state value (keeps the callback identity stable).
    const languageRef = useRef<Language>(language);
    useEffect(() => {
        languageRef.current = language;
    }, [language]);

    // Load the stored Language_Preference once authenticated; reset to English otherwise so a
    // signed-out client (and the next user) starts from the default (Req 10.2/10.3).
    useEffect(() => {
        if (status !== 'authenticated') {
            setLanguageState(DEFAULT_LANGUAGE);
            return;
        }

        let cancelled = false;
        void (async () => {
            try {
                const stored = await fetchProfileLanguage();
                if (!cancelled) {
                    setLanguageState(resolveStoredLanguage(stored));
                }
            } catch {
                // Unexpected failure: keep the English fallback (Req 10.3).
                if (!cancelled) {
                    setLanguageState(DEFAULT_LANGUAGE);
                }
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [status]);

    const setLanguage = useCallback((next: Language): void => {
        const previous = languageRef.current;
        if (next === previous) {
            return;
        }
        // Apply immediately so `t()` updates app-wide without waiting on the network (Req 10.2).
        setLanguageState(next);
        // Persist the choice; revert the in-memory language if the write fails (Req 10.1).
        void updateProfileLanguage(next).catch(() => {
            setLanguageState(previous);
        });
    }, []);

    return (
        <LocalizationProvider language={language} setLanguage={setLanguage}>
            {children}
        </LocalizationProvider>
    );
}
