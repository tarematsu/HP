import { collectAnghami } from './regional-music-anghami.js';
import { collectBugsArtists } from './regional-music-bugs.js';
import { collectNhacCuaTui } from './regional-music-nhaccuatui.js';

export const REGIONAL_MUSIC_DAILY_CRON = '20 15 * * *';

const DAILY_COLLECTORS = Object.freeze([
  collectBugsArtists,
  collectNhacCuaTui,
  collectAnghami,
]);

export async function collectRegionalMusicDaily(env, scheduledTime, fetchImpl = fetch) {
  const observedAt = Number(scheduledTime) || Date.now();
  const results = [];

  for (const collect of DAILY_COLLECTORS) {
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
