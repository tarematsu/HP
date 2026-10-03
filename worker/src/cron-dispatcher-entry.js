import { dispatchScheduledService } from './internal-scheduled-dispatch.js';
import {
  shouldDispatchSpotifyArtistChart,
  shouldDispatchSpotifyPlaycount,
} from './spotify-playcount-timing.js';

export const CRON_DISPATCHER_CRON = '* * * * *';
export const NOGIZAKA_CRON = '* * * * *';
export const OHISAMA_CRON = '*/5 * * * *';
export const SPOTIFY_PLAYCOUNT_CRON = '0 * * * *';
export const SPOTIFY_ARTIST_CHART_CRON = '20 22 * * *';
export const AMAZON_MUSIC_CRON = '0,10,15,20,30,40,50 * * * *';
export const YOUTUBE_MUSIC_DAILY_CRON = '0 15 * * *';

function scheduledTimestamp(controller) {
  const value = Number(controller?.scheduledTime);
  return Number.isFinite(value) && value >= 0 ? value : Date.now();
}

function utcParts(timestamp) {
  const date = new Date(timestamp);
  return { hour: date.getUTCHours(), minute: date.getUTCMinutes() };
}

export function amazonMusicDue(timestamp) {
  const { hour, minute } = utcParts(timestamp);
  if (hour === 20 && minute === 0) return true;
  if (hour === 21 && minute === 0) return true;
  return hour >= 20 && hour <= 23 && [10, 20, 30, 40, 50].includes(minute);
}

async function dispatchHomePanel(env) {
  const targets = [
    [env?.HOMEPANEL_SCHEDULER_COORDINATOR, 'global', 'https://scheduler.internal/ensure'],
    [env?.HOMEPANEL_VIDEO_FEED_COORDINATOR, 'video-liveness', 'https://homepanel.internal/video-liveness-run'],
    [env?.HOMEPANEL_VIDEO_FEED_COORDINATOR, 'tver-feed-refresh', 'https://homepanel.internal/tver-feed-refresh-run'],
  ];
  await Promise.all(targets.map(async ([namespace, name, url]) => {
    if (!namespace?.getByName) throw new Error(`HomePanel Durable Object binding unavailable: ${name}`);
    const response = await namespace.getByName(name).fetch(url, { method: 'POST' });
    if (!response.ok) throw new Error(`HomePanel ${name} dispatch failed (${response.status})`);
    try { await response.body?.cancel(); } catch {}
  }));
}

export async function runCronDispatcher(controller, env) {
  const scheduledAt = scheduledTimestamp(controller);
  const { hour, minute } = utcParts(scheduledAt);
  const tasks = [
    ['nogizaka46smej', dispatchScheduledService(env?.NOGIZAKA_SCHEDULED, NOGIZAKA_CRON, scheduledAt)],
  ];

  // Buddies owns :00/:05/... independently. Keep Ohisama one minute later.
  if (minute % 5 === 1) {
    tasks.push(['ohisama', dispatchScheduledService(env?.OHISAMA_SCHEDULED, OHISAMA_CRON, scheduledAt)]);
  }
  if (shouldDispatchSpotifyPlaycount(scheduledAt)) {
    tasks.push(['spotify-playcount', dispatchScheduledService(
      env?.SPOTIFY_PLAYCOUNT_SCHEDULED,
      SPOTIFY_PLAYCOUNT_CRON,
      scheduledAt,
    )]);
  }
  if (shouldDispatchSpotifyArtistChart(scheduledAt)) {
    tasks.push(['spotify-artist-chart', dispatchScheduledService(
      env?.SPOTIFY_PLAYCOUNT_SCHEDULED,
      SPOTIFY_ARTIST_CHART_CRON,
      scheduledAt,
    )]);
  }
  if (amazonMusicDue(scheduledAt)) {
    tasks.push(['amazon-apple-music', dispatchScheduledService(
      env?.AMAZON_MUSIC_SCHEDULED,
      AMAZON_MUSIC_CRON,
      scheduledAt,
    )]);
  }
  if (hour === 15 && minute === 0) {
    tasks.push(['youtube-music', dispatchScheduledService(
      env?.REGIONAL_MUSIC_SCHEDULED,
      YOUTUBE_MUSIC_DAILY_CRON,
      scheduledAt,
    )]);
  }
  if (minute === 0) tasks.push(['homepanel', dispatchHomePanel(env)]);

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
