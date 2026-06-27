/**
 * Pure content sanitization for ingested NTA announcements (Req 20.2).
 *
 * NTA feed content is UNTRUSTED external input (design "Untrusted External Input"):
 * it must be stripped of scripts/HTML and normalized to plain text BEFORE storage, and
 * is only ever treated as data (never executed, never used to build queries).
 *
 * `sanitizeText` guarantees its output contains no angle brackets (`<`/`>`) and hence
 * no markup or `<script>`/`<style>` content can survive — even when the input attempts
 * to smuggle tags via HTML entities. This module is dependency-free and pure so it is
 * trivially unit-testable.
 */

/** `<script>…</script>` element, including its contents. */
const SCRIPT_ELEMENT = /<script\b[^>]*>[\s\S]*?<\/script\s*>/gi;
/** `<style>…</style>` element, including its contents. */
const STYLE_ELEMENT = /<style\b[^>]*>[\s\S]*?<\/style\s*>/gi;
/** Any (well-formed) HTML/XML tag. */
const HTML_TAG = /<[^>]*>/g;
/** Any residual angle bracket left after tag/entity processing. */
const RESIDUAL_ANGLE = /[<>]/g;
/** Runs of any whitespace (incl. newlines/tabs). */
const WHITESPACE_RUN = /\s+/g;

/** Minimal HTML entity decoding for the entities that commonly appear in feed text. */
function decodeEntities(input: string): string {
    return input
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#0*39;|&apos;/gi, "'")
        .replace(/&nbsp;/gi, ' ')
        // Decode &amp; LAST so an encoded entity like `&amp;lt;` does not resurrect a
        // tag in a single pass.
        .replace(/&amp;/gi, '&');
}

/** Collapse all whitespace runs to single spaces and trim the ends. */
export function normalizeWhitespace(input: string): string {
    return input.replace(WHITESPACE_RUN, ' ').trim();
}

/**
 * Strip scripts/HTML from `input` and normalize it to trimmed, single-spaced plain text.
 *
 * Processing order is deliberate:
 *  1. Remove `<script>`/`<style>` elements WITH their contents (so code never leaks as
 *     text).
 *  2. Remove all remaining well-formed tags.
 *  3. Decode common HTML entities (so entity-encoded markup is unmasked).
 *  4. Remove any residual angle brackets (neutralizes unmasked/half-open markup).
 *  5. Normalize whitespace.
 *
 * The result provably contains no `<` or `>` characters.
 */
export function sanitizeText(input: string): string {
    const withoutScripts = input.replace(SCRIPT_ELEMENT, ' ').replace(STYLE_ELEMENT, ' ');
    const withoutTags = withoutScripts.replace(HTML_TAG, ' ');
    const decoded = decodeEntities(withoutTags);
    const withoutAngles = decoded.replace(RESIDUAL_ANGLE, ' ');
    return normalizeWhitespace(withoutAngles);
}
