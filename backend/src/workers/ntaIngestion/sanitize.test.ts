import { describe, expect, it } from 'vitest';

import { normalizeWhitespace, sanitizeText } from './sanitize';

describe('sanitizeText', () => {
    it('removes <script> elements together with their contents', () => {
        const out = sanitizeText('Hello<script>alert("xss")</script> World');
        expect(out).not.toMatch(/alert/);
        expect(out).not.toMatch(/[<>]/);
        expect(out).toBe('Hello World');
    });

    it('removes <style> elements together with their contents', () => {
        const out = sanitizeText('Heading<style>.a{color:red}</style> body');
        expect(out).not.toMatch(/color:red/);
        expect(out).toBe('Heading body');
    });

    it('strips ordinary HTML tags but keeps their text content', () => {
        const out = sanitizeText('<p>Exam <b>date</b> moved</p>');
        expect(out).toBe('Exam date moved');
        expect(out).not.toMatch(/[<>]/);
    });

    it('neutralizes entity-encoded markup so no angle brackets survive', () => {
        const out = sanitizeText('&lt;script&gt;evil()&lt;/script&gt;');
        expect(out).not.toMatch(/[<>]/);
    });

    it('decodes common entities to plain text', () => {
        expect(sanitizeText('Tom &amp; Jerry &quot;quote&quot;')).toBe('Tom & Jerry "quote"');
        expect(sanitizeText('a&nbsp;b')).toBe('a b');
    });

    it('collapses whitespace and trims', () => {
        expect(sanitizeText('  many\n\t  spaces   here  ')).toBe('many spaces here');
    });

    it('returns an empty string for markup-only input', () => {
        expect(sanitizeText('<br/><hr/>')).toBe('');
        expect(sanitizeText('   ')).toBe('');
    });

    it('handles a half-open / malformed tag without leaking angle brackets', () => {
        const out = sanitizeText('text <not a real tag and more text');
        expect(out).not.toMatch(/[<>]/);
    });
});

describe('normalizeWhitespace', () => {
    it('collapses runs of whitespace to single spaces and trims', () => {
        expect(normalizeWhitespace('\t a  b \n c ')).toBe('a b c');
    });
});
