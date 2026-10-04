import app, { REGIONAL_MUSIC_DAILY_CRON, YOUTUBE_MUSIC_DAILY_CRON } from './regional-music-entry.js';
import { handleInternalScheduled } from './internal-scheduled-dispatch.js';
import {
  KUGOU_ACG_BACKFILL_BATCH_SIZE,
  KUGOU_ACG_BACKFILL_DEFAULT_START,
  KUGOU_ACG_BACKFILL_MESSAGE_TYPE,
  runKugouAcgBackfillBatch,
} from './kugou-acg-backfill.js';
import { KUGOU_ACG_HISTORY_PROGRESS_KEY } from './kugou-acg-chart-history.js';
import { publishRegionalMusicServiceReadModel } from './regional-music-read-model.js';
import {
  REGIONAL_SCHEDULED_JOB_CRONS,
  runRegionalScheduledJob,
} from './regional-music-scheduled-jobs.js';

export const REGIONAL_MUSIC_ALLOWED_CRONS = Object.freeze([
  YOUTUBE_MUSIC_DAILY_CRON,
  REGIONAL_MUSIC_DAILY_CRON,
  ...REGIONAL_SCHEDULED_JOB_CRONS,
]);
export { KUGOU_ACG_BACKFILL_MESSAGE_TYPE };

async function runScheduled(controller, env, ctx) {
  if (REGIONAL_SCHEDULED_JOB_CRONS.includes(controller?.cron)) {
    const scheduledAt = Number(controller?.scheduledTime) || Date.now();
    const run = runRegionalScheduledJob(controller.cron, env, scheduledAt);
    if (ctx?.waitUntil) ctx.waitUntil(run);
    return run;
  }
  return app.scheduled(controller, env, ctx);
}

function backfillErrorDetail(error) {
  return [
    error?.name,
    error?.message,
    error?.cause?.message || error?.cause,
    error?.stack,
  ].filter(Boolean).map(String).join(' | ').slice(0, 3000);
}

async function recordKugouBackfillFailure(env, body, error) {
  if (!env?.PAGES_RESPONSE_R2?.put) return;
  const updatedAt = Date.now();
  await env.PAGES_RESPONSE_R2.put(KUGOU_ACG_HISTORY_PROGRESS_KEY, JSON.stringify({
    version: 1,
    status: 'error',
    complete: false,
    updated_at: updatedAt,
    start_date: String(body?.start_date || KUGOU_ACG_BACKFILL_DEFAULT_START),
    requested_at: Number(body?.requested_at) || null,
    last_error: backfillErrorDetail(error),
  }), {
    httpMetadata: { contentType: 'application/json; charset=utf-8' },
  });
}

export async function runRegionalMusicServiceQueue(batch, env, context, dependencies = {}) {
  const messages = batch?.messages || [];
  const message = messages[0];
  if (!message || message?.body?.message_type !== KUGOU_ACG_BACKFILL_MESSAGE_TYPE) {
    const delegate = dependencies.delegateQueue || app.queue;
    return delegate(batch, env, context);
  }

  const body = message.body || {};
  const runBackfill = dependencies.runBackfill || runKugouAcgBackfillBatch;
  const publishReadModel = dependencies.publishReadModel || publishRegionalMusicServiceReadModel;
  const sendContinuation = dependencies.sendContinuation || (async (nextBody) => {
    if (!env?.REGIONAL_MUSIC_QUEUE?.send) throw new Error('REGIONAL_MUSIC_QUEUE binding is required');
    await env.REGIONAL_MUSIC_QUEUE.send(nextBody, { contentType: 'json', delaySeconds: 1 });
  });

  const startDate = String(body.start_date || KUGOU_ACG_BACKFILL_DEFAULT_START);
  const batchSize = Number(body.batch_size) || KUGOU_ACG_BACKFILL_BATCH_SIZE;
  try {
    const result = await runBackfill(env, {
      startDate,
      batchSize,
      now: Date.now(),
    }, globalThis.fetch);

    await publishReadModel(env, 'kugou_music', Date.now());

    if (!result.complete) {
      await sendContinuation({
        message_type: KUGOU_ACG_BACKFILL_MESSAGE_TYPE,
        message_version: 1,
        start_date: startDate,
        batch_size: batchSize,
        requested_at: Number(body.requested_at) || Date.now(),
      });
    }

    console.log(JSON.stringify({ event: 'kugou_acg_backfill_batch_complete', ...result }));
    message.ack?.();
    return result;
  } catch (error) {
    await recordKugouBackfillFailure(env, body, error).catch((recordError) => {
      console.error(JSON.stringify({
        event: 'kugou_acg_backfill_failure_record_failed',
        error: String(recordError?.message || recordError).slice(0, 800),
      }));
    });
    console.error(JSON.stringify({
      event: 'kugou_acg_backfill_batch_failed',
      start_date: startDate,
      error: backfillErrorDetail(error),
    }));
    throw error;
  }
}

export default {
  scheduled: runScheduled,
  queue: runRegionalMusicServiceQueue,
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