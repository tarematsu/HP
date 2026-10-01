import { collectBugsArtists } from './regional-music-bugs.js';

export const REGIONAL_MUSIC_DAILY_CRON = '20 15 * * *';

export async function collectRegionalMusicDaily(env, scheduledTime, fetchImpl = fetch) {
  const observedAt = Number(scheduledTime) || Date.now();
  const results = [];

  for (const collect of [collectBugsArtists]) {
    try {
      results.push(await collect(env, observedAt, fetchImpl));
    } catch (error) {
      results.push({
        service: collect.name,
        status: 'error',
        error: String(error?.message || error),
      });
    }
  }

  console.log(JSON.stringify({ event: 'regional-music-daily-complete', results }));
  return results;
}

export default {
  async scheduled(controller, env, ctx) {
    const scheduledTime = Number(controller?.scheduledTime) || Date.now();
    const run = collectRegionalMusicDaily(env, scheduledTime);
    if (ctx?.waitUntil) ctx.waitUntil(run);
    else await run;
  },
};
