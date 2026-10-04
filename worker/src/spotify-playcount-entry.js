import { processSpotifyPlaycountBatch } from './spotify-playcount-collector.js';
import { runSpotifyScheduledWork } from './spotify-playcount-scheduled-run.js';
import { configureStationheadTrackResolver } from './spotify-stationhead-identity.js';

export default {
  async scheduled(controller, env, ctx) {
    const work = runSpotifyScheduledWork(controller, env);
    if (ctx?.waitUntil) {
      ctx.waitUntil(work);
      return;
    }
    await work;
  },

  async queue(batch, env, ctx) {
    configureStationheadTrackResolver(env?.MINUTE_DB);
    return processSpotifyPlaycountBatch(batch, env, { ctx });
  },

  async fetch() {
    return new Response('Not found', { status: 404 });
  },
};
