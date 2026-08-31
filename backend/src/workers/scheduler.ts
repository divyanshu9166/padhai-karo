import { refreshCurrentAffairsHandler } from '@/services/currentAffairs';
import { generateDailyBriefingsForUsers } from '@/services/briefing';
import { sendScheduledRevisionRemindersHandler } from '@/services/notifications';
import { syncConnectedGoogleCalendars } from '@/services/calendar';

/** One safe, repeatable scheduler tick. It is deliberately independent of an HTTP server. */
export async function runScheduledJobs(): Promise<{ currentAffairs: number; briefings: number; calendar: { checked: number; imported: number; failed: number }; push: boolean }> {
    let currentAffairs = 0;
    try {
        const response = await refreshCurrentAffairsHandler(new Request('http://scheduler.local/api/current-affairs/refresh'), { user: { id: 'scheduler' } } as never);
        if (response.ok) { const body = await response.json() as { imported?: number }; currentAffairs = body.imported ?? 0; }
    } catch { /* a feed outage must not stop briefing/push work */ }
    const briefings = await generateDailyBriefingsForUsers();
    const calendar = await syncConnectedGoogleCalendars();
    let push = false;
    const pushSecret = process.env.PUSH_CRON_SECRET?.trim() || process.env.CRON_SECRET?.trim();
    if (pushSecret) {
        const response = await sendScheduledRevisionRemindersHandler(new Request('http://scheduler.local/api/notifications/cron', { method: 'POST', headers: { 'x-push-cron-secret': pushSecret } }));
        push = response.ok;
    }
    return { currentAffairs, briefings: briefings.generated, calendar, push };
}

export function startScheduler(intervalMs = 15 * 60 * 1000): NodeJS.Timeout {
    void runScheduledJobs().catch(() => undefined);
    return setInterval(() => { void runScheduledJobs().catch(() => undefined); }, intervalMs);
}

if (process.argv[1]?.endsWith('scheduler.ts')) {
    startScheduler();
    process.once('SIGTERM', () => process.exit(0));
    process.once('SIGINT', () => process.exit(0));
}
