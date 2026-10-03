import app, { REGIONAL_MUSIC_DAILY_CRON, YOUTUBE_MUSIC_DAILY_CRON } from './regional-music-entry.js';
import { handleInternalScheduled } from './internal-scheduled-dispatch.js';
import {
  REGIONAL_SCHEDULED_JOB_CRONS,
  runRegionalScheduledJob,
} from './regional-music-scheduled-jobs.js';

export const REGIONAL_MUSIC_ALLOWED_CRONS = Object.freeze([
  YOUTUBE_MUSIC_DAILY_CRON,
  REGIONAL_MUSIC_DAILY_CRON,
  ...REGIONAL_SCHEDULED_JOB_CRONS,
]);

async function runScheduled(controller, env, ctx) {
  if (REGIONAL_SCHEDULED_JOB_CRONS.includes(controller?.cron)) {
    const scheduledAt = Number(controller?.scheduledTime) || Date.now();
    const run = runRegionalScheduledJob(controller.cron, env, scheduledAt);
    if (ctx?.waitUntil) ctx.waitUntil(run);
    return run;
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
      YOUTUBE_MUSIC_DAILY_CRON,
      REGIONAL_MUSIC_ALLOWED_CRONS,
    );
    if (internal) return internal;
    return new Response('Not found', { status: 404 });
  },
};
