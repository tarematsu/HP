import { collectAmazonMusicSnapshot } from './amazon-music-collector.js';
import { collectAppleMusicSnapshot } from './apple-music-collector.js';

export default {
  async scheduled(controller, env, ctx) {
    const scheduledTime = Number(controller?.scheduledTime) || Date.now();
    const amazonRun = collectAmazonMusicSnapshot(env, scheduledTime)
      .then((result) => {
        console.log(JSON.stringify({ event: 'amazon-music-collection-complete', ...result }));
        return result;
      })
      .catch((error) => {
        console.error('amazon-music-collection-failed', {
          error: String(error?.stack || error?.message || error).slice(0, 1200),
        });
        throw error;
      });

    const appleRun = collectAppleMusicSnapshot(env, scheduledTime)
      .then((result) => {
        console.log(JSON.stringify({ event: 'apple-music-collection-complete', ...result }));
        return result;
      })
      .catch((error) => {
        console.error('apple-music-collection-failed', {
          error: String(error?.stack || error?.message || error).slice(0, 1200),
        });
        return null;
      });

    const run = Promise.all([amazonRun, appleRun]);
    if (ctx?.waitUntil) ctx.waitUntil(run);
    else await run;
  },
};
