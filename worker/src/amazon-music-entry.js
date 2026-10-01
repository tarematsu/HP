import {
  continueAmazonDaily50kScan,
  startAmazonDaily50kScan,
} from './amazon-music-daily-50k.js';
import { canonicalizeAppleMusicPresentation } from './apple-music-canonical-presentation.js';
import { collectAppleMusicSnapshot } from './apple-music-collector.js';
import { appleMusicFetch } from './apple-music-fetch.js';
import {
  amazonMusicServiceEnv,
  persistAmazonMusicModelToOther,
  persistAppleMusicModelToOther,
} from './music-service-other-store.js';

export const AMAZON_MUSIC_CRON = '0,12,15,22,32,42,52 * * * *';

function loggedRun(label, operation, { fatal = false } = {}) {
  return operation()
    .then((result) => {
      console.log(JSON.stringify({ event: `${label}-complete`, ...result }));
      return result;
    })
    .catch((error) => {
      console.error(`${label}-failed`, {
        error: String(error?.stack || error?.message || error).slice(0, 1200),
      });
      if (fatal) throw error;
      return null;
    });
}

async function collectAppleMusic(env, scheduledTime) {
  const result = await collectAppleMusicSnapshot(env, scheduledTime, appleMusicFetch);
  const presentation = await canonicalizeAppleMusicPresentation(env, scheduledTime, {
    force: Boolean(result?.changed || result?.migrated_track_ids),
  });
  if (presentation?.updated) result.canonical_presentation = presentation;
  if (result?.changed || result?.migrated_track_ids || presentation?.presentation_changed) {
    result.other_db = await persistAppleMusicModelToOther(env, scheduledTime);
  }
  return result;
}

async function runAmazon50k(env, scheduledTime, { start = false } = {}) {
  const serviceEnv = amazonMusicServiceEnv(env);
  const result = start
    ? await startAmazonDaily50kScan(serviceEnv, scheduledTime)
    : await continueAmazonDaily50kScan(serviceEnv, scheduledTime);
  if (result?.published) result.other_db = await persistAmazonMusicModelToOther(env, scheduledTime);
  return result;
}

export function amazonMusicDueTasks(scheduledTime) {
  const date = new Date(Number(scheduledTime) || Date.now());
  const hour = date.getUTCHours();
  const minute = date.getUTCMinutes();
  return {
    apple: minute === 15,
    daily50kStart: hour === 17 && minute === 0,
    daily50kContinue: hour >= 17 && hour <= 20 && [12, 22, 32, 42, 52].includes(minute),
  };
}

function scheduledRuns(env, scheduledTime) {
  const due = amazonMusicDueTasks(scheduledTime);
  const runs = [];
  if (due.daily50kStart) {
    runs.push(loggedRun(
      'amazon-music-daily-50k-start',
      () => runAmazon50k(env, scheduledTime, { start: true }),
    ));
  } else if (due.daily50kContinue) {
    runs.push(loggedRun(
      'amazon-music-daily-50k-continue',
      () => runAmazon50k(env, scheduledTime),
    ));
  }
  if (due.apple) {
    runs.push(loggedRun(
      'apple-music-collection',
      () => collectAppleMusic(env, scheduledTime),
    ));
  }
  return runs;
}

export default {
  async scheduled(controller, env, ctx) {
    const scheduledTime = Number(controller?.scheduledTime) || Date.now();
    const run = Promise.all(scheduledRuns(env, scheduledTime));
    if (ctx?.waitUntil) ctx.waitUntil(run);
    else await run;
  },
};
