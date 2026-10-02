import app from './spotify-playcount-entry.js';
import { runSpotifyArtistChartScheduled } from './spotify-artist-chart-collector.js';
import { handleInternalScheduled } from './internal-scheduled-dispatch.js';

export const SPOTIFY_PLAYCOUNT_CRON = '0 * * * *';
export const SPOTIFY_ARTIST_CHART_CRON = '20 22 * * *';

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
    const internal = await handleInternalScheduled(
      request,
      env,
      runScheduled,
      SPOTIFY_PLAYCOUNT_CRON,
      [SPOTIFY_PLAYCOUNT_CRON, SPOTIFY_ARTIST_CHART_CRON],
    );
    if (internal) return internal;
    return app.fetch(request, env);
  },
};
