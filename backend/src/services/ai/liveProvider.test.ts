import { afterEach, describe, expect, it, vi } from 'vitest';

import { configuredProviderName, liveProviderConfigured, summarizeImageWithGemini, summarizeWithGemini, transcribeAudio } from './liveProvider';

const original = {
    provider: process.env.AI_PROVIDER,
    key: process.env.AI_PROVIDER_API_KEY,
    model: process.env.AI_PROVIDER_MODEL,
    visionModel: process.env.AI_PROVIDER_VISION_MODEL,
};

afterEach(() => {
    for (const [key, value] of Object.entries({ AI_PROVIDER: original.provider, AI_PROVIDER_API_KEY: original.key, AI_PROVIDER_MODEL: original.model, AI_PROVIDER_VISION_MODEL: original.visionModel })) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    vi.unstubAllGlobals();
});

function useGroq(): void {
    process.env.AI_PROVIDER = 'GROQ';
    process.env.AI_PROVIDER_API_KEY = 'test-key';
    process.env.AI_PROVIDER_MODEL = 'openai/gpt-oss-20b';
    process.env.AI_PROVIDER_VISION_MODEL = 'qwen/qwen3.8-27b';
}

describe('Groq live provider', () => {
    it('uses the production text model and JSON mode for summaries', async () => {
        useGroq();
        const fetchMock = vi.fn(async () => Response.json({ choices: [{ message: { content: JSON.stringify({ title: 'Polity', keyPoints: ['Federalism'], revisionCapsule: ['Federalism'], flashcards: [] }) } }] }));
        vi.stubGlobal('fetch', fetchMock);

        const summary = await summarizeWithGemini('Federalism notes');
        expect(summary.keyPoints).toEqual(['Federalism']);
        const [url, init] = (fetchMock.mock.calls as unknown as Array<[string, RequestInit]>)[0];
        expect(url).toBe('https://api.groq.com/openai/v1/chat/completions');
        const body = JSON.parse(String(init.body));
        expect(body.model).toBe('openai/gpt-oss-20b');
        expect(body.response_format).toEqual({ type: 'json_object' });
    });

    it('switches image requests to the configured vision model', async () => {
        useGroq();
        const fetchMock = vi.fn(async () => Response.json({ choices: [{ message: { content: JSON.stringify({ title: 'Map', keyPoints: ['River system'] }) } }] }));
        vi.stubGlobal('fetch', fetchMock);

        await summarizeImageWithGemini('data:image/png;base64,YQ==', 'image/png');
        const body = JSON.parse(String((fetchMock.mock.calls as unknown as Array<[string, RequestInit]>)[0][1].body));
        expect(body.model).toBe('qwen/qwen3.8-27b');
        expect(body.messages[0].content[1].image_url.url).toBe('data:image/png;base64,YQ==');
    });

    it('uses Groq Whisper multipart transcription without forwarding the key to clients', async () => {
        useGroq();
        const fetchMock = vi.fn(async () => Response.json({ text: 'मुद्रास्फीति के नोट्स' }));
        vi.stubGlobal('fetch', fetchMock);

        await expect(transcribeAudio('data:audio/mp4;base64,YQ==', 'audio/mp4')).resolves.toBe('मुद्रास्फीति के नोट्स');
        const [url, init] = (fetchMock.mock.calls as unknown as Array<[string, RequestInit]>)[0];
        expect(url).toBe('https://api.groq.com/openai/v1/audio/transcriptions');
        expect(init.headers).toEqual({ Authorization: 'Bearer test-key' });
        expect(init.body).toBeInstanceOf(FormData);
    });

    it('does not accept malformed image data or send a provider request', async () => {
        useGroq();
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        await expect(summarizeImageWithGemini('not-base64!', 'image/png')).rejects.toThrow('valid base64');
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('rejects malformed model JSON instead of silently treating it as a summary', async () => {
        useGroq();
        vi.stubGlobal('fetch', vi.fn(async () => Response.json({ choices: [{ message: { content: 'not json' } }] })));
        await expect(summarizeWithGemini('Federalism notes')).rejects.toThrow('invalid JSON');
    });

    it('uses the current Gemini default and keeps the API key out of request URLs', async () => {
        process.env.AI_PROVIDER = 'GEMINI';
        process.env.AI_PROVIDER_API_KEY = 'test-key';
        delete process.env.AI_PROVIDER_MODEL;
        const fetchMock = vi.fn(async () => Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ keyPoints: ['Federalism'] }) }] } }] }));
        vi.stubGlobal('fetch', fetchMock);
        await summarizeWithGemini('Federalism notes');
        const [url, init] = (fetchMock.mock.calls as unknown as Array<[string, RequestInit]>)[0];
        expect(url).toContain('/models/gemini-3.8-flash:generateContent');
        expect(url).not.toContain('test-key');
        expect(new Headers(init.headers).get('x-goog-api-key')).toBe('test-key');
    });

    it('reports invalid provider configuration as unavailable without throwing from health checks', () => {
        process.env.AI_PROVIDER = 'NOT_A_PROVIDER';
        process.env.AI_PROVIDER_API_KEY = 'test-key';
        expect(configuredProviderName()).toBe('INVALID');
        expect(liveProviderConfigured()).toBe(false);
    });
});
