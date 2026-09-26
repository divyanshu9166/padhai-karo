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

    it('falls back to English when the selected language value is missing (Req 10.3)', () => {
        const partial: StringCatalog = { 'x.retry': { en: 'Retry' }, 'x.save': { en: 'Save', hi: 'सहेजें' } };
        expect(resolveString('HI', 'x.retry', partial)).toBe('Retry');
        expect(resolveString('TA', 'x.save', partial)).toBe('Save');
        expect(resolveString('HI', 'x.save', partial)).toBe('सहेजें');
    });

    it('ships every catalog key in all six languages', () => {
        const missing = Object.entries(stringCatalog).flatMap(([key, value]) =>
            (['en', 'hi', 'ta', 'bn', 'te', 'mr'] as const).filter((lang) => !(value as Record<string, string>)[lang]).map((lang) => `${key}:${lang}`));
        expect(missing).toEqual([]);
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
        expect(hi('common.retry')).toBe('फिर प्रयास करें');
        expect(createResolver('HI', { 'x.only': { en: 'Only English' } })('x.only')).toBe('Only English');

        const en = createResolver('EN');
        expect(en('common.save')).toBe('Save');
    });
});
