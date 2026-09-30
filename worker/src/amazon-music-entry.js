import {
  checkAmazonUpdateAndQueue100k,
  continueQueuedAmazon100kScan,
} from './amazon-music-pipeline.js';
import { collectAppleMusicSnapshot } from './apple-music-collector.js';
import { appleMusicFetch } from './apple-music-fetch.js';

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

export default {
  async scheduled(controller, env, ctx) {
    const scheduledTime = Number(controller?.scheduledTime) || Date.now();
    const cron = String(controller?.cron || '');

    let run;
    if (cron === APPLE_MUSIC_PROBE_CRON) {
      run = loggedRun(
        'apple-music-collection',
        () => collectAppleMusicSnapshot(env, scheduledTime, appleMusicFetch),
      );
    } else if (cron === AMAZON_MUSIC_TOP_SCAN_CRON) {
      run = loggedRun(
        'amazon-music-top-500-monitor',
        () => checkAmazonUpdateAndQueue100k(env, scheduledTime),
      );
    } else if (cron === AMAZON_MUSIC_DEEP_SCAN_CRON) {
      run = loggedRun(
        'amazon-music-100k-scan',
        () => continueQueuedAmazon100kScan(env, scheduledTime),
      );
    } else {
      // Manual/test scheduled invocations retain the hourly Amazon update check
      // and Apple Music probe, without reviving the retired daily Amazon collector.
      run = Promise.all([
        loggedRun(
          'amazon-music-top-500-monitor',
          () => checkAmazonUpdateAndQueue100k(env, scheduledTime),
        ),
        loggedRun(
          'apple-music-collection',
          () => collectAppleMusicSnapshot(env, scheduledTime, appleMusicFetch),
        ),
      ]);
    }

    if (ctx?.waitUntil) ctx.waitUntil(run);
    else await run;
  },
};
