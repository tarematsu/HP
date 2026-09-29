import { collectAmazonMusicSnapshot } from './amazon-music-collector.js';

export default {
  async scheduled(controller, env, ctx) {
    const run = collectAmazonMusicSnapshot(env, Number(controller?.scheduledTime) || Date.now())
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
    if (ctx?.waitUntil) ctx.waitUntil(run);
    else await run;
  },
};
