import { collectAnghami } from './regional-music-anghami.js';
import { collectBoomplay } from './regional-music-boomplay.js';
import { collectBugsArtists } from './regional-music-bugs.js';
import { collectFlo } from './regional-music-flo.js';
import { collectFungjai } from './regional-music-fungjai.js';
import { collectGaana } from './regional-music-gaana.js';
import { collectGenie } from './regional-music-genie.js';
import { collectJioSaavn } from './regional-music-jiosaavn.js';
import { collectJooxArtists } from './regional-music-joox.js';
import { collectKugouMusic } from './regional-music-kugou.js';
import { collectLangitMusik } from './regional-music-langit.js';
import { collectMelon } from './regional-music-melon.js';
import { collectNaverVibe } from './regional-music-vibe.js';
import { collectNeteaseCloudMusic } from './regional-music-netease.js';
import { collectNhacCuaTui } from './regional-music-nhaccuatui.js';
import { collectPlern } from './regional-music-plern.js';
import { collectQqMusic } from './regional-music-qq.js';
import { collectYandexMusic } from './regional-music-yandex.js';
import { collectYouTubeMusic } from './regional-music-youtube-music.js';
import { collectZingMp3 } from './regional-music-zing.js';
import { publishRegionalMusicReadModel } from './regional-music-read-model.js';

export const YOUTUBE_MUSIC_DAILY_CRON = '0 15 * * *';
export const REGIONAL_MUSIC_DAILY_CRON = '0 21 * * *';
export const REGIONAL_MUSIC_COLLECTOR_CONCURRENCY = 4;
export const REGIONAL_MUSIC_COLLECTOR_TIMEOUT_MS = 90_000;

export const REGIONAL_MUSIC_SERVICE_COLLECTORS_BY_ID = Object.freeze({
  genie: collectGenie,
  bugs: collectBugsArtists,
  joox: collectJooxArtists,
  nhaccuatui: collectNhacCuaTui,
  anghami: collectAnghami,
  melon: collectMelon,
  qq_music: collectQqMusic,
  netease_cloud_music: collectNeteaseCloudMusic,
  kugou_music: collectKugouMusic,
  naver_vibe: collectNaverVibe,
  flo: collectFlo,
  yandex_music: collectYandexMusic,
  boomplay: collectBoomplay,
  plern: collectPlern,
  fungjai: collectFungjai,
  zing_mp3: collectZingMp3,
  jiosaavn: collectJioSaavn,
  gaana: collectGaana,
  langit_musik: collectLangitMusik,
});

// The 19 regional/local services added by the regional-music rollout.
export const REGIONAL_MUSIC_SERVICE_COLLECTORS = Object.freeze(
  Object.values(REGIONAL_MUSIC_SERVICE_COLLECTORS_BY_ID),
);

export const YOUTUBE_MUSIC_DAILY_COLLECTORS = Object.freeze([
  collectYouTubeMusic,
]);

// Keep the all-service set for explicit/manual compatibility. Production
// regional services are dispatched one at a time through regional-music-daily.
export const REGIONAL_MUSIC_DAILY_COLLECTORS = Object.freeze([
  ...YOUTUBE_MUSIC_DAILY_COLLECTORS,
  ...REGIONAL_MUSIC_SERVICE_COLLECTORS,
]);

function collectorFetch(fetchImpl, signal) {
  return (input, init = {}) => {
    const upstreamSignal = init?.signal;
    const combinedSignal = upstreamSignal && typeof AbortSignal.any === 'function'
      ? AbortSignal.any([signal, upstreamSignal])
      : signal;
    return fetchImpl(input, { ...init, signal: combinedSignal });
  };
}

async function collectWithIsolation(
  collect,
  env,
  observedAt,
  fetchImpl,
  timeoutMs = REGIONAL_MUSIC_COLLECTOR_TIMEOUT_MS,
) {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(`collector timed out after ${timeoutMs}ms`);
      error.name = 'TimeoutError';
      controller.abort(error);
      reject(error);
    }, timeoutMs);
  });

  try {
    return await Promise.race([
      collect(env, observedAt, collectorFetch(fetchImpl, controller.signal)),
      timeout,
    ]);
  } catch (error) {
    return {
      service: collect.name,
      status: 'error',
      error: String(error?.message || error),
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function runRegionalMusicCollectors(
  collectors,
  env,
  observedAt,
  fetchImpl = fetch,
  concurrency = REGIONAL_MUSIC_COLLECTOR_CONCURRENCY,
  timeoutMs = REGIONAL_MUSIC_COLLECTOR_TIMEOUT_MS,
) {
  const list = Array.from(collectors || []);
  if (list.length === 0) return [];

  const workerCount = Math.min(
    list.length,
    Math.max(1, Math.floor(Number(concurrency) || REGIONAL_MUSIC_COLLECTOR_CONCURRENCY)),
  );
  const collectorTimeoutMs = Math.max(1, Math.floor(Number(timeoutMs) || REGIONAL_MUSIC_COLLECTOR_TIMEOUT_MS));
  const results = new Array(list.length);
  let nextIndex = 0;

  const workers = Array.from({ length: workerCount }, async () => {
    while (nextIndex < list.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await collectWithIsolation(
        list[index],
        env,
        observedAt,
        fetchImpl,
        collectorTimeoutMs,
      );
    }
  });

  await Promise.all(workers);
  return results;
}

export async function collectRegionalMusicService(service, env, scheduledTime, fetchImpl = fetch) {
  const collector = REGIONAL_MUSIC_SERVICE_COLLECTORS_BY_ID[String(service || '')];
  if (!collector) throw new Error(`unknown regional music service: ${service || '(empty)'}`);
  const observedAt = Number(scheduledTime) || Date.now();
  return collectWithIsolation(collector, env, observedAt, fetchImpl);
}

async function collectAndPublish(collectors, env, scheduledTime, fetchImpl = fetch, event = 'regional-music-daily-complete') {
  const observedAt = Number(scheduledTime) || Date.now();
  const results = await runRegionalMusicCollectors(
    collectors,
    env,
    observedAt,
    fetchImpl,
  );

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

  console.log(JSON.stringify({ event, results }));
  return results;
}

function collectorsForEnvironment(env) {
  return env?.REGIONAL_MUSIC_REGIONAL_ONLY === '1'
    ? REGIONAL_MUSIC_SERVICE_COLLECTORS
    : REGIONAL_MUSIC_DAILY_COLLECTORS;
}

export async function collectRegionalMusicDaily(env, scheduledTime, fetchImpl = fetch) {
  return collectAndPublish(
    collectorsForEnvironment(env),
    env,
    scheduledTime,
    fetchImpl,
  );
}

export async function collectRegionalServicesDaily(env, scheduledTime, fetchImpl = fetch) {
  return collectAndPublish(
    REGIONAL_MUSIC_SERVICE_COLLECTORS,
    env,
    scheduledTime,
    fetchImpl,
    'regional-music-services-daily-complete',
  );
}

export async function collectYouTubeMusicDaily(env, scheduledTime, fetchImpl = fetch) {
  return collectAndPublish(
    YOUTUBE_MUSIC_DAILY_COLLECTORS,
    env,
    scheduledTime,
    fetchImpl,
    'youtube-music-daily-complete',
  );
}

export function scheduledCollectorForCron(cron) {
  if (cron === YOUTUBE_MUSIC_DAILY_CRON) return collectYouTubeMusicDaily;
  if (cron === REGIONAL_MUSIC_DAILY_CRON) return collectRegionalServicesDaily;
  return collectRegionalMusicDaily;
}

export async function runRegionalMusicQueue(batch, env, fetchImpl = fetch) {
  for (const message of batch?.messages || []) {
    const body = message?.body || {};
    if (body.message_type === 'regional-music-collect') {
      const result = await collectRegionalMusicService(body.service, env, body.scheduled_at, fetchImpl);
      console.log(JSON.stringify({ event: 'regional-music-service-complete', service: body.service, result }));
      message.ack?.();
      continue;
    }
    if (body.message_type === 'regional-music-publish') {
      const observedAt = Number(body.scheduled_at) || Date.now();
      const result = await publishRegionalMusicReadModel(env, observedAt);
      console.log(JSON.stringify({ event: 'regional-music-read-model-complete', result }));
      message.ack?.();
      continue;
    }
    throw new Error(`unknown regional music queue message: ${body.message_type || '(empty)'}`);
  }
}

export default {
  async scheduled(controller, env, ctx) {
    const scheduledTime = Number(controller?.scheduledTime) || Date.now();
    const collect = scheduledCollectorForCron(controller?.cron);
    const run = collect(env, scheduledTime);
    if (ctx?.waitUntil) ctx.waitUntil(run);
    await run;
  },
  queue: runRegionalMusicQueue,
};
