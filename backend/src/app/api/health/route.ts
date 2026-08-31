import { liveProviderConfigured, transcriptionProviderConfigured } from '@/services/ai/liveProvider';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

async function pdfRendererConfigured(): Promise<boolean> {
    const binary = process.env.PDF_RENDERER_BIN?.trim() || (process.platform === 'win32' ? 'pdftoppm.cmd' : 'pdftoppm');
    try { await execFileAsync(binary, ['-h'], { windowsHide: true, timeout: 3000 }); return true; } catch { return false; }
}

/**
 * Liveness probe used by the mobile connectivity monitor and deployment checks.
 */
export async function GET(): Promise<Response> {
    const pdfRenderer = await pdfRendererConfigured();
    return Response.json({
        status: 'ok',
        service: 'padhai-karo-backend',
        capabilities: {
            aiVisionAndText: liveProviderConfigured(),
            voiceTranscription: transcriptionProviderConfigured(),
            currentAffairsFeed: true,
            pushScheduler: Boolean(process.env.PUSH_CRON_SECRET?.trim() || process.env.CRON_SECRET?.trim()),
            currentAffairsScheduler: Boolean(process.env.CURRENT_AFFAIRS_CRON_SECRET?.trim() || process.env.CRON_SECRET?.trim()),
            briefingScheduler: Boolean(process.env.BRIEFING_CRON_SECRET?.trim() || process.env.CRON_SECRET?.trim()),
            calendarScheduler: Boolean(process.env.CALENDAR_CRON_SECRET?.trim() || process.env.CRON_SECRET?.trim()),
            googleCalendarOAuth: Boolean(process.env.GOOGLE_CLIENT_ID?.trim() && process.env.GOOGLE_CLIENT_SECRET?.trim() && process.env.GOOGLE_REDIRECT_URI?.trim()),
            ambientAudio: true,
            coachingProvider: Boolean(process.env.COACHING_PROVIDER_URL?.trim() && process.env.COACHING_PROVIDER_API_KEY?.trim()),
            communityModeration: Boolean(process.env.MODERATION_KEY?.trim()),
            pdfVisualRendering: pdfRenderer,
        },
        setup: {
            pdfRenderer: pdfRenderer ? 'ready' : 'Install Poppler or set PDF_RENDERER_BIN.',
            scheduler: 'Run npm run worker:scheduler on a long-lived worker, or configure the documented platform cron endpoints.',
            ai: liveProviderConfigured() ? 'configured' : 'Set AI_PROVIDER and AI_PROVIDER_API_KEY for live vision/text.',
            transcription: transcriptionProviderConfigured() ? 'configured' : 'Set TRANSCRIPTION_API_URL/KEY or Gemini audio credentials.',
            googleCalendar: process.env.GOOGLE_CLIENT_ID?.trim() && process.env.GOOGLE_CLIENT_SECRET?.trim() && process.env.GOOGLE_REDIRECT_URI?.trim() ? 'configured' : 'Set Google OAuth credentials.',
        },
    });
}
