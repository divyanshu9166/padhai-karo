import { describe, expect, it } from 'vitest';

import { stringCatalog } from './catalog';
import { createResolver, resolveString } from './resolver';
import type { StringCatalog } from './types';

describe('resolveString', () => {
    it('returns the Hindi string for HI preference when a Hindi value is present', () => {
        expect(resolveString('HI', 'common.save')).toBe(stringCatalog['common.save'].hi);
        expect(resolveString('HI', 'common.save')).toBe('सहेजें');
    });

    it('returns the English string for EN preference', () => {
        expect(resolveString('EN', 'common.save')).toBe('Save');
        expect(resolveString('EN', 'onboarding.title')).toBe('Welcome');
    });

    it('falls back to English for HI when the Hindi value is missing (Req 10.3)', () => {
        expect('hi' in stringCatalog['common.retry']).toBe(false);
        expect(resolveString('HI', 'common.retry')).toBe('Retry');
        expect(resolveString('HI', 'paywall.restorePurchase')).toBe('Restore purchase');
    });

    it('returns the key itself when it is absent from the catalog', () => {
        const customCatalog: StringCatalog = { 'a.known': { en: 'Known' } };
        expect(resolveString('EN', 'a.missing', customCatalog)).toBe('a.missing');
    });
});

describe('createResolver', () => {
    it('binds a language once and resolves many keys against it', () => {
        const hi = createResolver('HI');
        expect(hi('common.save')).toBe('सहेजें');
        expect(hi('common.retry')).toBe('Retry');

        const en = createResolver('EN');
        expect(en('common.save')).toBe('Save');
    });
});
