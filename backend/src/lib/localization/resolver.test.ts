import { describe, expect, it } from 'vitest';
import { resolveString, createResolver } from './resolver';
import { stringCatalog } from './catalog';
import type { StringCatalog } from './types';

describe('resolveString', () => {
    it('returns the Hindi string for HI preference when a Hindi value is present', () => {
        // 'common.save' has both en and hi values.
        expect(resolveString('HI', 'common.save')).toBe(stringCatalog['common.save'].hi);
        expect(resolveString('HI', 'common.save')).toBe('सहेजें');
    });

    it('returns the English string for EN preference', () => {
        expect(resolveString('EN', 'common.save')).toBe('Save');
        // EN must use English even when a Hindi translation exists.
        expect(resolveString('EN', 'onboarding.title')).toBe('Welcome');
    });

    it('falls back to the English string for HI preference when the Hindi value is missing (Req 10.3)', () => {
        // 'common.retry' and 'paywall.restorePurchase' intentionally ship without a hi value.
        expect('hi' in stringCatalog['common.retry']).toBe(false);
        expect(resolveString('HI', 'common.retry')).toBe('Retry');
        expect(resolveString('HI', 'paywall.restorePurchase')).toBe('Restore purchase');
    });

    it('returns the key itself when the key is absent from the catalog (graceful degradation)', () => {
        const customCatalog: StringCatalog = { 'a.known': { en: 'Known' } };
        expect(resolveString('EN', 'a.missing', customCatalog)).toBe('a.missing');
        expect(resolveString('HI', 'a.missing', customCatalog)).toBe('a.missing');
    });

    it('resolves against a supplied catalog rather than the shipped one', () => {
        const customCatalog: StringCatalog = {
            greeting: { en: 'Hello', hi: 'नमस्ते' },
            farewell: { en: 'Bye' }, // no hi → fallback
        };
        expect(resolveString('HI', 'greeting', customCatalog)).toBe('नमस्ते');
        expect(resolveString('EN', 'greeting', customCatalog)).toBe('Hello');
        expect(resolveString('HI', 'farewell', customCatalog)).toBe('Bye');
    });
});

describe('createResolver', () => {
    it('binds a language once and resolves many keys against it', () => {
        const hi = createResolver('HI');
        expect(hi('common.save')).toBe('सहेजें');
        // Bound HI resolver still falls back to English for keys missing a Hindi value.
        expect(hi('common.retry')).toBe('Retry');

        const en = createResolver('EN');
        expect(en('common.save')).toBe('Save');
    });
});
