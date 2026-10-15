import { runSpotifyArtistChartScheduled } from './spotify-artist-chart-collector.js';
import { SPOTIFY_CHART_WORK, processJapanChartMessage, enqueueJapanCharts } from './spotify-japan-charts.js';
import app from './spotify-playcount-entry.js';
import {
  enqueueSpotifyScheduledDispatch,
  SPOTIFY_ARTIST_CHART_CRON,
  SPOTIFY_PLAYCOUNT_CRON,
} from './spotify-scheduled-queue.js';

export { SPOTIFY_ARTIST_CHART_CRON, SPOTIFY_PLAYCOUNT_CRON };

async function runScheduled(controller, env, ctx) {
  if (controller?.cron === SPOTIFY_ARTIST_CHART_CRON) {
    const rawTime = Number(controller?.scheduledTime);
    const timestamp = Number.isFinite(rawTime) ? rawTime : Date.now();
    await enqueueJapanCharts(env, timestamp);
    return runSpotifyArtistChartScheduled(env, timestamp);
  }
  return app.scheduled(controller, env, ctx);
}

export default {
  scheduled: runScheduled,
  async queue(batch, env, ctx) {
    const regular = [];
    for (const entry of batch.messages || []) {
      if (entry.body?.message_type === SPOTIFY_CHART_WORK) await processJapanChartMessage(entry, env);
      else regular.push(entry);
    }
    if (regular.length) return app.queue({ ...batch, messages: regular }, env, ctx);
  },
  async fetch(request, env) {
    const internal = await enqueueSpotifyScheduledDispatch(request, env);
    if (internal) return internal;
    return app.fetch(request, env);
  },
};
