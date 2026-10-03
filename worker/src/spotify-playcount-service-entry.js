import app from './spotify-playcount-entry.js';
import { runSpotifyArtistChartScheduled } from './spotify-artist-chart-collector.js';
import {
  enqueueSpotifyScheduledDispatch,
  SPOTIFY_ARTIST_CHART_CRON,
  SPOTIFY_PLAYCOUNT_CRON,
} from './spotify-scheduled-queue.js';

export { SPOTIFY_ARTIST_CHART_CRON, SPOTIFY_PLAYCOUNT_CRON };

async function runScheduled(controller, env, ctx) {
  if (controller?.cron === SPOTIFY_ARTIST_CHART_CRON) {
    const rawTime = Number(controller?.scheduledTime);
    return runSpotifyArtistChartScheduled(env, Number.isFinite(rawTime) ? rawTime : Date.now());
  }
  return app.scheduled(controller, env, ctx);
}

export default {
  scheduled: runScheduled,
  queue: app.queue,
  async fetch(request, env) {
    const internal = await enqueueSpotifyScheduledDispatch(request, env);
    if (internal) return internal;
    return app.fetch(request, env);
  },
};
