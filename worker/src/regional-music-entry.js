import { collectAnghami } from './regional-music-anghami.js';
import { collectBugsArtists } from './regional-music-bugs.js';
import { collectFlo } from './regional-music-flo.js';
import { collectGaana } from './regional-music-gaana.js';
import { collectGenie } from './regional-music-genie.js';
import { collectJioSaavn } from './regional-music-jiosaavn.js';
import { collectJooxArtists } from './regional-music-joox.js';
import { collectKugouMusic } from './regional-music-kugou.js';
import { collectMelon } from './regional-music-melon.js';
import { collectNaverVibe } from './regional-music-vibe.js';
import { collectNeteaseCloudMusic } from './regional-music-netease.js';
import { collectNhacCuaTui } from './regional-music-nhaccuatui.js';
import { collectQqMusic } from './regional-music-qq.js';
import { collectYandexMusic } from './regional-music-yandex.js';
import { publishRegionalMusicReadModel } from './regional-music-read-model.js';

export const REGIONAL_MUSIC_DAILY_CRON = '20 15 * * *';

const DAILY_COLLECTORS = Object.freeze([
  collectGenie,
  collectBugsArtists,
  collectJooxArtists,
  collectNhacCuaTui,
  collectAnghami,
  collectMelon,
  collectQqMusic,
  collectNeteaseCloudMusic,
  collectKugouMusic,
  collectNaverVibe,
  collectFlo,
  collectYandexMusic,
  collectJioSaavn,
  collectGaana,
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

  try {
    const published = await publishRegionalMusicReadModel(env, observedAt);
    results.push({ service: 'regional-music-read-model', status: 'ok', ...published });
  } catch (error) {
    results.push({
      service: 'regional-music-read-model',
      status: 'error',
      error: String(error?.message || error),
    });
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
