import { refreshCurrentAffairsHandler } from '@/services/currentAffairs';

void (async () => {
    const response = await refreshCurrentAffairsHandler(new Request('http://cli.local/api/current-affairs/refresh'), { user: { id: 'cli-current-affairs' } } as never);
    console.log(await response.text());
    if (!response.ok) process.exitCode = 1;
})();
