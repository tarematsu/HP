import {
  processSpotifyPlaycountBatch,
  runSpotifyPlaycountScheduled,
} from './spotify-playcount-collector.js';

export default {
  async scheduled(controller, env, ctx) {
    const work = runSpotifyPlaycountScheduled(controller, env);
    if (ctx?.waitUntil) {
      ctx.waitUntil(work);
      return;
    }
    await work;
  },

  async queue(batch, env, ctx) {
    return processSpotifyPlaycountBatch(batch, env, { ctx });
  },

  async fetch() {
    return new Response('Not found', { status: 404 });
  },
};
