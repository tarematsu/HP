import {
  checkAmazonUpdateAndQueue100k,
  continueQueuedAmazon100kScan,
} from './amazon-music-pipeline.js';
import { collectAppleMusicSnapshot } from './apple-music-collector.js';
import { appleMusicFetch } from './apple-music-fetch.js';
import {
  amazonMusicServiceEnv,
  persistAmazonMusicModelToOther,
  persistAppleMusicModelToOther,
} from './music-service-other-store.js';

export const AMAZON_MUSIC_CRON = '2,5,12,15,22,32,42,52 * * * *';
export const AMAZON_MUSIC_TOP_SCAN_CRON = '5 * * * *';
export const AMAZON_MUSIC_DEEP_SCAN_CRON = '2,12,22,32,42,52 * * * *';
export const APPLE_MUSIC_PROBE_CRON = '15 * * * *';

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
  if (result?.changed || result?.migrated_track_ids) {
    result.other_db = await persistAppleMusicModelToOther(env, scheduledTime);
  }
  return result;
}

async function checkAmazonMusic(env, scheduledTime) {
  return checkAmazonUpdateAndQueue100k(amazonMusicServiceEnv(env), scheduledTime);
}

async function continueAmazonMusic(env, scheduledTime) {
  const result = await continueQueuedAmazon100kScan(amazonMusicServiceEnv(env), scheduledTime);
  const persisted = await persistAmazonMusicModelToOther(env, scheduledTime);
  return { ...result, other_db: persisted };
}

export function amazonMusicDueTasks(scheduledTime) {
  const minute = new Date(Number(scheduledTime) || Date.now()).getUTCMinutes();
  return {
    apple: minute === 15,
    top500: minute === 5,
    deep100k: minute % 10 === 2,
  };
}

function unifiedScheduledRuns(env, scheduledTime) {
  const due = amazonMusicDueTasks(scheduledTime);
  const runs = [];
  if (due.apple) {
    runs.push(loggedRun(
      'apple-music-collection',
      () => collectAppleMusic(env, scheduledTime),
    ));
  }
  if (due.top500) {
    runs.push(loggedRun(
      'amazon-music-top-500-monitor',
      () => checkAmazonMusic(env, scheduledTime),
    ));
  }
  if (due.deep100k) {
    runs.push(loggedRun(
      'amazon-music-100k-scan',
      () => continueAmazonMusic(env, scheduledTime),
    ));
  }
  return runs;
}

export default {
  async scheduled(controller, env, ctx) {
    const scheduledTime = Number(controller?.scheduledTime) || Date.now();
    const cron = String(controller?.cron || '');

    let run;
    if (cron === AMAZON_MUSIC_CRON) {
      run = Promise.all(unifiedScheduledRuns(env, scheduledTime));
    } else if (cron === APPLE_MUSIC_PROBE_CRON) {
      run = loggedRun(
        'apple-music-collection',
        () => collectAppleMusic(env, scheduledTime),
      );
    } else if (cron === AMAZON_MUSIC_TOP_SCAN_CRON) {
      run = loggedRun(
        'amazon-music-top-500-monitor',
        () => checkAmazonMusic(env, scheduledTime),
      );
    } else if (cron === AMAZON_MUSIC_DEEP_SCAN_CRON) {
      run = loggedRun(
        'amazon-music-100k-scan',
        () => continueAmazonMusic(env, scheduledTime),
      );
    } else {
      // Manual/test scheduled invocations retain the hourly Amazon update check
      // and Apple Music probe, without reviving the retired daily Amazon collector.
      run = Promise.all([
        loggedRun(
          'amazon-music-top-500-monitor',
          () => checkAmazonMusic(env, scheduledTime),
        ),
        loggedRun(
          'apple-music-collection',
          () => collectAppleMusic(env, scheduledTime),
        ),
      ]);
    }

    if (ctx?.waitUntil) ctx.waitUntil(run);
    else await run;
  },
};
