import { dispatchScheduledService } from './internal-scheduled-dispatch.js';
import {
  AMAZON_MUSIC_CRON,
  CRON_DISPATCHER_CRON,
  HISTORY_READ_MODEL_RECOVERY_CRON,
  KKBOX_WEEKLY_CRON,
  KUGOU_ACG_WEEKLY_CRON,
  KUGOU_WEEKDAY_CRON,
  MUSIC_PLAYLIST_REFRESH_CRON,
  NOGIZAKA_CRON,
  OHISAMA_CRON,
  QQ_TOPLIST_POLL_CRON,
  QQ_WEEKLY_CRON,
  SPOTIFY_ARTIST_CHART_CRON,
  SPOTIFY_PLAYCOUNT_CRON,
  STATIONHEAD_FOLLOWERS_CRON,
  STATIONHEAD_LEADERBOARD_CRON,
  YOUTUBE_MUSIC_DAILY_CRON,
} from './scheduled-crons.js';
import { shouldDispatchSpotifyArtistChart, shouldDispatchSpotifyPlaycount } from './spotify-playcount-timing.js';

export {
  AMAZON_MUSIC_CRON,
  CRON_DISPATCHER_CRON,
  HISTORY_READ_MODEL_RECOVERY_CRON,
  KKBOX_WEEKLY_CRON,
  KUGOU_ACG_WEEKLY_CRON,
  KUGOU_WEEKDAY_CRON,
  MUSIC_PLAYLIST_REFRESH_CRON,
  NOGIZAKA_CRON,
  OHISAMA_CRON,
  QQ_TOPLIST_POLL_CRON,
  QQ_WEEKLY_CRON,
  SPOTIFY_ARTIST_CHART_CRON,
  SPOTIFY_PLAYCOUNT_CRON,
  STATIONHEAD_FOLLOWERS_CRON,
  STATIONHEAD_LEADERBOARD_CRON,
  YOUTUBE_MUSIC_DAILY_CRON,
};

function scheduledTimestamp(controller) {
  const value = Number(controller?.scheduledTime);
  return Number.isFinite(value) && value >= 0 ? value : Date.now();
}

function utcParts(timestamp) {
  const date = new Date(timestamp);
  return { day: date.getUTCDay(), hour: date.getUTCHours(), minute: date.getUTCMinutes() };
}

export function amazonMusicDue(timestamp) {
  const { hour, minute } = utcParts(timestamp);
  if (hour === 20 && minute === 0) return true;
  if (hour === 21 && minute === 0) return true;
  return hour >= 20 && hour <= 23 && [10, 20, 30, 40, 50].includes(minute);
}

async function dispatchHomePanel(env) {
  const scheduler = env?.HOMEPANEL_SCHEDULER_COORDINATOR;
  if (!scheduler?.getByName) throw new Error('HomePanel Durable Object binding unavailable: global');
  const schedulerResponse = await scheduler.getByName('global').fetch('https://scheduler.internal/wake', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ names: ['radar'] }),
  });
  if (!schedulerResponse.ok) throw new Error(`HomePanel global dispatch failed (${schedulerResponse.status})`);
  try { await schedulerResponse.body?.cancel(); } catch {}
  await Promise.all([
    [env?.HOMEPANEL_VIDEO_FEED_COORDINATOR, 'video-liveness', 'https://homepanel.internal/video-liveness-run'],
    [env?.HOMEPANEL_VIDEO_FEED_COORDINATOR, 'tver-feed-refresh', 'https://homepanel.internal/tver-feed-refresh-run'],
  ].map(async ([namespace, name, url]) => {
    if (!namespace?.getByName) throw new Error(`HomePanel Durable Object binding unavailable: ${name}`);
    const response = await namespace.getByName(name).fetch(url, { method: 'POST' });
    if (!response.ok) throw new Error(`HomePanel ${name} dispatch failed (${response.status})`);
    try { await response.body?.cancel(); } catch {}
  }));
}

const due = {
  always: () => true,
  ohisama: ({ minute }) => minute % 5 === 1,
  spotifyPlaycount: (_parts, timestamp) => shouldDispatchSpotifyPlaycount(timestamp),
  spotifyArtistChart: (_parts, timestamp) => shouldDispatchSpotifyArtistChart(timestamp),
  amazon: (_parts, timestamp) => amazonMusicDue(timestamp),
  playlists: ({ hour, minute }) => minute === 0 && [5, 17].includes(hour),
  daily15: ({ hour, minute }) => hour === 15 && minute === 0,
  kkbox: ({ day, hour, minute }) => day === 0 && hour === 15 && minute === 0,
  qqWeekly: ({ day, hour, minute }) => day === 4 && hour === 9 && minute === 0,
  kugou: ({ day, hour, minute }) => day >= 1 && day <= 5 && hour === 2 && minute === 30,
  kugouAcg: ({ day, hour, minute }) => day === 3 && hour === 2 && minute === 40,
  qqToplists: ({ day, hour, minute }) => day === 4 && hour >= 9 && hour <= 21 && minute === 30,
  leaderboard: ({ day, hour, minute }) => day === 1 && hour === 12 && minute === 17,
};

const JOBS = Object.freeze([
  // Recovery only: the normal Stationhead leaderboard path reconciles revisions immediately after collection.
  ['pages-history-recovery', 'SCHEDULED_COLLECTION_JOBS', HISTORY_READ_MODEL_RECOVERY_CRON, due.always],
  ['nogizaka46smej', 'NOGIZAKA_SCHEDULED', NOGIZAKA_CRON, due.always],
  ['ohisama', 'OHISAMA_SCHEDULED', OHISAMA_CRON, due.ohisama],
  ['spotify-playcount', 'SPOTIFY_PLAYCOUNT_SCHEDULED', SPOTIFY_PLAYCOUNT_CRON, due.spotifyPlaycount],
  ['spotify-artist-chart', 'SPOTIFY_PLAYCOUNT_SCHEDULED', SPOTIFY_ARTIST_CHART_CRON, due.spotifyArtistChart],
  ['amazon-apple-music', 'AMAZON_MUSIC_SCHEDULED', AMAZON_MUSIC_CRON, due.amazon],
  ['music-playlist-refresh', 'AMAZON_MUSIC_SCHEDULED', MUSIC_PLAYLIST_REFRESH_CRON, due.playlists],
  ['youtube-music', 'REGIONAL_MUSIC_SCHEDULED', YOUTUBE_MUSIC_DAILY_CRON, due.daily15],
  ['stationhead-followers', 'SCHEDULED_COLLECTION_JOBS', STATIONHEAD_FOLLOWERS_CRON, due.daily15],
  ['kkbox', 'REGIONAL_MUSIC_SCHEDULED', KKBOX_WEEKLY_CRON, due.kkbox],
  ['qq-music', 'REGIONAL_MUSIC_SCHEDULED', QQ_WEEKLY_CRON, due.qqWeekly],
  ['kugou-music', 'REGIONAL_MUSIC_SCHEDULED', KUGOU_WEEKDAY_CRON, due.kugou],
  ['kugou-acg', 'REGIONAL_MUSIC_SCHEDULED', KUGOU_ACG_WEEKLY_CRON, due.kugouAcg],
  ['qq-toplists', 'REGIONAL_MUSIC_SCHEDULED', QQ_TOPLIST_POLL_CRON, due.qqToplists],
  ['stationhead-leaderboard', 'SCHEDULED_COLLECTION_JOBS', STATIONHEAD_LEADERBOARD_CRON, due.leaderboard],
]);

export async function runCronDispatcher(controller, env) {
  const scheduledAt = scheduledTimestamp(controller);
  const parts = utcParts(scheduledAt);
  const tasks = JOBS
    .filter(([, , , isDue]) => isDue(parts, scheduledAt))
    .map(([name, binding, cron]) => [name, dispatchScheduledService(env?.[binding], cron, scheduledAt)]);
  if (parts.minute === 0) tasks.push(['homepanel', dispatchHomePanel(env)]);
  const settled = await Promise.allSettled(tasks.map(([, promise]) => promise));
  const failures = [];
  const results = {};
  settled.forEach((result, index) => {
    const name = tasks[index][0];
    if (result.status === 'fulfilled') results[name] = result.value ?? true;
    else failures.push({ name, error: String(result.reason?.message || result.reason).slice(0, 800) });
  });
  if (failures.length) {
    console.error(JSON.stringify({ event: 'cron_dispatch_failed', scheduled_at: scheduledAt, failures }));
    throw new AggregateError(failures.map(({ error }) => new Error(error)), 'cron dispatcher target failure');
  }
  return { scheduled_at: scheduledAt, results };
}

export default {
  scheduled(controller, env, ctx) {
    if (controller?.cron && controller.cron !== CRON_DISPATCHER_CRON) return;
    const run = runCronDispatcher(controller, env);
    if (ctx?.waitUntil) ctx.waitUntil(run);
    else return run;
  },
};
