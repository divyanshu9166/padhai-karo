import { describe, expect, it } from 'vitest';

import { stringCatalog } from './catalog';
import { resolveStoredLanguage } from './preference';
import { createResolver } from './resolver';
import { DEFAULT_LANGUAGE, type Language } from './types';

/**
 * Unit tests for the stored-preference → active-language resolution (task 21.8, Req 10.2/10.3).
 * The stored Language_Preference governs rendering (overriding the device locale); when no
 * preference is stored the System falls back to English.
 */
describe('resolveStoredLanguage', () => {
    it('uses the stored preference when present (overrides device locale, Req 10.2)', () => {
        expect(resolveStoredLanguage('HI')).toBe('HI');
        expect(resolveStoredLanguage('EN')).toBe('EN');
    });

    it('falls back to English when no preference is stored (Req 10.3)', () => {
        expect(resolveStoredLanguage(null)).toBe(DEFAULT_LANGUAGE);
        expect(resolveStoredLanguage(undefined)).toBe(DEFAULT_LANGUAGE);
        expect(resolveStoredLanguage(null)).toBe('EN');
    });
});

/**
 * Localized rendering honors the stored Language_Preference over the device locale (Req 10.2).
 *
 * The resolver never consults the device/system locale: the only language it ever sees is the
 * one resolved from the stored preference. These tests pin that down by pairing a (simulated)
 * device locale with a DIFFERENT stored preference and asserting the rendered strings always
 * follow the stored preference, not the device locale.
 */
describe('localized rendering honors stored preference over device locale (Req 10.2)', () => {
    // Stand-in for whatever the OS reports (e.g. expo-localization / Intl). The production
    // resolver deliberately ignores this value; the stored preference is the sole input.
    const deviceLocale: Language = 'HI';

    it('renders the stored EN preference even when the device locale is HI', () => {
        const stored: Language | null = 'EN';
        // Sanity: the device locale genuinely differs from the stored preference.
        expect(deviceLocale).not.toBe(stored);

        const language = resolveStoredLanguage(stored);
        expect(language).toBe('EN');

        const t = createResolver(language);
        // English strings render despite the device reporting Hindi.
        expect(t('common.save')).toBe('Save');
        expect(t('common.save')).toBe(stringCatalog['common.save'].en);
        expect(t('common.save')).not.toBe(stringCatalog['common.save'].hi);
    });

    it('renders the stored HI preference even when the device locale is EN', () => {
        const localEnglishDevice: Language = 'EN';
        const stored: Language | null = 'HI';
        expect(localEnglishDevice).not.toBe(stored);

        const language = resolveStoredLanguage(stored);
        expect(language).toBe('HI');

        const t = createResolver(language);
        // Hindi strings render despite the device reporting English.
        expect(t('common.save')).toBe('सहेजें');
        expect(t('common.save')).toBe(stringCatalog['common.save'].hi);
    });

    it('falls back to the English string for a missing Hindi key under a HI preference (Req 10.3)', () => {
        const language = resolveStoredLanguage('HI');
        const t = createResolver(language);
        // `common.retry` ships without a Hindi value, so HI rendering falls back to English.
        expect('hi' in stringCatalog['common.retry']).toBe(false);
        expect(t('common.retry')).toBe(stringCatalog['common.retry'].en);
        expect(t('common.retry')).toBe('Retry');
    });
});
