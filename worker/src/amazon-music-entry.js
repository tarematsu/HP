import { collectAmazonMusicSnapshot } from './amazon-music-collector.js';
import { collectAppleMusicSnapshot } from './apple-music-collector.js';
import { appleMusicFetch } from './apple-music-fetch.js';

export const AMAZON_MUSIC_DAILY_CRON = '30 1 * * *';
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
    } else if (cron === AMAZON_MUSIC_DAILY_CRON) {
      run = loggedRun(
        'amazon-music-collection',
        () => collectAmazonMusicSnapshot(env, scheduledTime),
        { fatal: true },
      );
    } else {
      // Manual/test scheduled invocations without a known cron retain the old behavior.
      run = Promise.all([
        loggedRun(
          'amazon-music-collection',
          () => collectAmazonMusicSnapshot(env, scheduledTime),
          { fatal: true },
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
