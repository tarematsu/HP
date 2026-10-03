import { runSpotifyArtistChartScheduled } from './spotify-artist-chart-collector.js';
import { runSpotifyPlaycountScheduled } from './spotify-playcount-schedule.js';

export const SPOTIFY_SCHEDULED_DISPATCH_TYPE = 'spotify-scheduled-dispatch';
export const SPOTIFY_PLAYCOUNT_CRON = '0 * * * *';
export const SPOTIFY_ARTIST_CHART_CRON = '20 22 * * *';
const ALLOWED_CRONS = new Set([SPOTIFY_PLAYCOUNT_CRON, SPOTIFY_ARTIST_CHART_CRON]);

function normalizedScheduledTime(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : Date.now();
}

export async function enqueueSpotifyScheduledDispatch(request, env) {
  const url = new URL(request.url);
  if (request.method !== 'POST' || url.pathname !== '/__internal/scheduled') return null;

  const payload = await request.json().catch(() => ({}));
  const cron = String(payload?.cron || SPOTIFY_PLAYCOUNT_CRON);
  if (!ALLOWED_CRONS.has(cron)) {
    return Response.json({ ok: false, error: 'unsupported scheduled cron' }, {
      status: 400,
      headers: { 'cache-control': 'no-store' },
    });
  }
  const queue = env?.SPOTIFY_PLAYCOUNT_QUEUE;
  if (!queue?.send) {
    return Response.json({ ok: false, error: 'Spotify Queue is unavailable' }, {
      status: 503,
      headers: { 'cache-control': 'no-store' },
    });
  }
  await queue.send({
    message_type: SPOTIFY_SCHEDULED_DISPATCH_TYPE,
    message_version: 1,
    cron,
    scheduled_time: normalizedScheduledTime(payload?.scheduled_time),
  }, { contentType: 'json' });
  return Response.json({ ok: true, queued: true }, {
    headers: { 'cache-control': 'no-store' },
  });
}

export async function processSpotifyScheduledDispatchEntry(entry, env, dependencies = {}) {
  const message = entry?.body;
  const cron = String(message?.cron || '');
  if (message?.message_type !== SPOTIFY_SCHEDULED_DISPATCH_TYPE
      || Number(message?.message_version) !== 1
      || !ALLOWED_CRONS.has(cron)) {
    entry?.ack?.();
    return { processed: 0, failed: 0, ignored: 1 };
  }
  const scheduledTime = normalizedScheduledTime(message.scheduled_time);
  const runPlaycount = dependencies.runSpotifyPlaycountScheduled || runSpotifyPlaycountScheduled;
  const runArtistChart = dependencies.runSpotifyArtistChartScheduled || runSpotifyArtistChartScheduled;
  try {
    if (cron === SPOTIFY_ARTIST_CHART_CRON) await runArtistChart(env, scheduledTime);
    else await runPlaycount({ cron, scheduledTime }, env);
    entry.ack?.();
    return { processed: 1, failed: 0, ignored: 0 };
  } catch (error) {
    entry.retry?.();
    console.error('Spotify scheduled Queue dispatch failed', {
      cron,
      scheduled_time: scheduledTime,
      error: String(error),
    });
    return { processed: 0, failed: 1, ignored: 0 };
  }
}
