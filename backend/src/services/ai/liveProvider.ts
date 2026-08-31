import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';

import type { AiSummaryResult } from './types';

interface GeminiPart { text?: string; inlineData?: { mimeType: string; data: string } }

function apiKey(): string { return process.env.AI_PROVIDER_API_KEY?.trim() ?? ''; }
function model(): string { return process.env.AI_PROVIDER_MODEL?.trim() || 'gemini-2.0-flash'; }
function provider(): 'GEMINI' | 'CLAUDE' { return process.env.AI_PROVIDER?.trim().toUpperCase() === 'CLAUDE' ? 'CLAUDE' : 'GEMINI'; }

export function liveProviderConfigured(): boolean { return apiKey().length > 0; }
export function transcriptionProviderConfigured(): boolean {
    return Boolean((process.env.TRANSCRIPTION_API_URL?.trim() && process.env.TRANSCRIPTION_PROVIDER_API_KEY?.trim()) || (apiKey() && provider() === 'GEMINI'));
}

export async function summarizeWithGemini(text: string): Promise<AiSummaryResult> {
    return parseGemini(await callLive([
        { text: 'You are a concise UPSC/SSC study coach. Return strict JSON with keys title, keyPoints, revisionCapsule and flashcards. Do not invent facts. Note:\n' + text },
    ]));
}

export async function summarizeImageWithGemini(imageData: string, mimeType: string): Promise<AiSummaryResult> {
    return parseGemini(await callLive([
        { text: 'Read this study-note image and return strict JSON with keys title, keyPoints, revisionCapsule and flashcards. Preserve uncertainty instead of hallucinating.' },
        { inlineData: { mimeType: mimeType || 'image/jpeg', data: stripDataUrl(imageData) } },
    ]));
}

export async function transcribeAudio(audioData: string, mimeType: string): Promise<string> {
    const endpoint = process.env.TRANSCRIPTION_API_URL?.trim();
    const key = process.env.TRANSCRIPTION_PROVIDER_API_KEY?.trim();
    if (endpoint && key) {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
            body: JSON.stringify({ audioBase64: stripDataUrl(audioData), mimeType: mimeType || 'audio/mp4', language: 'en-IN' }),
        });
        if (!response.ok) throw new Error('Transcription provider returned ' + response.status);
        const payload = await response.json() as Record<string, unknown>;
        const output = typeof payload.text === 'string' ? payload.text.trim() : typeof payload.transcript === 'string' ? payload.transcript.trim() : '';
        if (!output) throw new Error('Transcription provider returned no text.');
        return output;
    }
    if (!apiKey() || provider() !== 'GEMINI') throw new Error('Transcription provider is not configured.');
    return parseTranscript(await callLive([
        { text: 'Transcribe this study voice note accurately. Return only the transcript, preserving technical terms and the original language.' },
        { inlineData: { mimeType: mimeType || 'audio/mp4', data: stripDataUrl(audioData) } },
    ], false));
}

/**
 * Run the configured vision model for the operator PYQ extractor. The returned JSON is
 * intentionally untrusted; the extraction worker validates option counts and replaces every
 * answer with the separately reviewed official answer key before persistence.
 */
export async function extractQuestionsWithVision(
    imageData: string,
    mimeType: string,
    context: { examTrack: string; year: number; subjectId: string },
): Promise<unknown> {
    const output = await callLive([
        { text: `Extract every multiple-choice question visible in this official exam page. Return strict JSON only in the shape {"questions":[{"questionRef":"1","questionText":"...","options":["...","...","...","..."],"modelCorrectOption":0}]}. Preserve the printed question reference. Do not invent missing text or options. Exam track: ${context.examTrack}; year: ${context.year}; subject: ${context.subjectId}.` },
        { inlineData: { mimeType: mimeType || 'image/png', data: stripDataUrl(imageData) } },
    ]);
    const cleaned = output.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/, '').trim();
    try { return JSON.parse(cleaned) as unknown; }
    catch { throw new Error('Vision provider returned invalid JSON.'); }
}

/** Load a local/data/HTTPS image source into a provider-compatible data URL. */
export async function loadVisionSource(sourceRef: string): Promise<{ dataUrl: string; mimeType: string }> {
    if (/^data:[^;]+;base64,/i.test(sourceRef)) {
        const match = sourceRef.match(/^data:([^;]+);base64,/i);
        return { dataUrl: sourceRef, mimeType: match?.[1] || 'image/png' };
    }
    let bytes: Buffer;
    let mimeType = 'image/png';
    if (/^https:\/\//i.test(sourceRef)) {
        const response = await fetch(sourceRef, { redirect: 'error' });
        if (!response.ok) throw new Error(`Vision source returned HTTP ${response.status}.`);
        bytes = Buffer.from(await response.arrayBuffer());
        mimeType = response.headers.get('content-type')?.split(';')[0] || mimeType;
    } else {
        bytes = await readFile(sourceRef);
        const extension = extname(sourceRef).toLowerCase();
        mimeType = extension === '.jpg' || extension === '.jpeg' ? 'image/jpeg' : extension === '.webp' ? 'image/webp' : 'image/png';
    }
    if (bytes.length === 0 || bytes.length > 20 * 1024 * 1024) throw new Error('Vision source is empty or larger than 20 MB.');
    return { dataUrl: `data:${mimeType};base64,${bytes.toString('base64')}`, mimeType };
}

async function callGemini(parts: GeminiPart[], jsonOutput = true): Promise<string> {
    const key = apiKey();
    if (!key) throw new Error('AI provider is not configured.');
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model()) + ':generateContent?key=' + encodeURIComponent(key);
    const generationConfig = jsonOutput ? { temperature: 0.2, responseMimeType: 'application/json' } : { temperature: 0.2 };
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig }) });
    if (!response.ok) throw new Error('AI provider returned ' + response.status);
    const payload = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    const output = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('').trim();
    if (!output) throw new Error('AI provider returned no content.');
    return output;
}

async function callLive(parts: GeminiPart[], jsonOutput = true): Promise<string> {
    if (provider() === 'CLAUDE') {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: { 'x-api-key': apiKey(), 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
            body: JSON.stringify({ model: model(), max_tokens: 1800, temperature: 0.2, messages: [{ role: 'user', content: parts.map((part) => part.text ? { type: 'text', text: part.text } : { type: 'image', source: { type: 'base64', media_type: part.inlineData?.mimeType || 'image/jpeg', data: part.inlineData?.data || '' } }) }] }),
        });
        if (!response.ok) throw new Error('AI provider returned ' + response.status);
        const payload = await response.json() as { content?: Array<{ type?: string; text?: string }> };
        const output = payload.content?.filter((part) => part.type === 'text').map((part) => part.text ?? '').join('').trim();
        if (!output) throw new Error('AI provider returned no content.');
        return output;
    }
    return callGemini(parts, jsonOutput);
}

function parseTranscript(output: string): string {
    const cleaned = output.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    try {
        const parsed = JSON.parse(cleaned) as Record<string, unknown>;
        const text = typeof parsed.text === 'string' ? parsed.text : typeof parsed.transcript === 'string' ? parsed.transcript : '';
        if (text.trim()) return text.trim();
    } catch { /* a plain-text provider response is the normal path */ }
    return cleaned;
}

function parseGemini(output: string): AiSummaryResult {
    const cleaned = output.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/, '').trim();
    try {
        const parsed = JSON.parse(cleaned) as Record<string, unknown>;
        const keyPoints = Array.isArray(parsed.keyPoints) ? parsed.keyPoints.filter((item): item is string => typeof item === 'string').slice(0, 20) : [];
        if (keyPoints.length === 0) throw new Error('AI response had no keyPoints.');
        return { ...parsed, keyPoints };
    } catch {
        return { title: 'AI study note', keyPoints: cleaned.split(/\\n+/).map((line) => line.replace(/^[-*]\\s*/, '').trim()).filter(Boolean).slice(0, 10) };
    }
}

function stripDataUrl(value: string): string { return value.replace(/^data:[^;]+;base64,/i, ''); }
