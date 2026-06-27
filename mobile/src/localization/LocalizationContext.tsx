/**
 * Localization context + hook (task 21.1 / 21.8, Req 10.2/10.3/10.4).
 *
 * Wraps the pure resolver in a React context so screens resolve strings by the current
 * Language_Preference with English fallback. This provider is intentionally *controlled* and
 * free of auth/network concerns: it renders whatever `language` it is given and exposes a
 * `setLanguage` callback supplied by its parent. The app-level wiring that loads the stored
 * preference from the User profile and persists changes lives in {@link AppLocalizationProvider}
 * (task 21.8), keeping this component a pure, easily-tested mapping from `language` → `t()`.
 *
 * The active language drives `t()` app-wide; when the parent updates `language`, every consumer
 * re-renders in the new language (Req 10.2). It never consults the device locale — the stored
 * Language_Preference is the sole source of truth, overriding any local client setting (Req 10.2).
 *
 * The resolver accepts an arbitrary string key (not just known catalog keys): unknown keys
 * degrade to the key itself (see `resolveString`), which keeps call sites that build keys
 * dynamically — e.g. enum-driven labels — simple and type-safe.
 */
import React, { createContext, useContext, useMemo } from 'react';

import { createResolver } from './resolver';
import { DEFAULT_LANGUAGE, type Language } from './types';

/** Resolve a catalog key to a string in the active language (English fallback). */
export type Translate = (key: string) => string;

/** Change the active Language_Preference. Supplied by the app wiring; persists + applies live. */
export type SetLanguage = (language: Language) => void;

interface LocalizationContextValue {
    /** The active interface language. */
    language: Language;
    /** Resolve a catalog key to a string in the active language. */
    t: Translate;
    /** Switch the active language (e.g. from a language toggle); a no-op if unwired. */
    setLanguage: SetLanguage;
}

const LocalizationContext = createContext<LocalizationContextValue | undefined>(undefined);

interface LocalizationProviderProps {
    /** The active language; defaults to English when unknown (Req 10.3). */
    language?: Language;
    /** Callback to change the language; defaults to a no-op when no parent wiring is provided. */
    setLanguage?: SetLanguage;
    children: React.ReactNode;
}

const NOOP_SET_LANGUAGE: SetLanguage = () => { };

export function LocalizationProvider({
    language = DEFAULT_LANGUAGE,
    setLanguage = NOOP_SET_LANGUAGE,
    children,
}: LocalizationProviderProps): React.JSX.Element {
    const value = useMemo<LocalizationContextValue>(
        () => ({ language, t: createResolver(language), setLanguage }),
        [language, setLanguage],
    );

    return <LocalizationContext.Provider value={value}>{children}</LocalizationContext.Provider>;
}

/** Access the active language, the `t` resolver, and `setLanguage`. Must be used under a provider. */
export function useLocalization(): LocalizationContextValue {
    const ctx = useContext(LocalizationContext);
    if (ctx === undefined) {
        throw new Error('useLocalization must be used within a LocalizationProvider');
    }
    return ctx;
}

/** Convenience hook returning just the `t` resolver. */
export function useTranslation(): Translate {
    return useLocalization().t;
}
