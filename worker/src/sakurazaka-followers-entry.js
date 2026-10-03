import app from './sakurazaka-entry.js';

export const STATIONHEAD_DAILY_FOLLOWERS_MESSAGE = 'stationhead-daily-followers';
export const SAKURAZAKA_CRON = '* * * * *';

function scheduledTimestamp(controller) {
  const value = Number(controller?.scheduledTime);
  return Number.isFinite(value) && value >= 0 ? value : Date.now();
}

export async function runSakurazakaFollowersScheduled(controller, env) {
  const scheduledAt = scheduledTimestamp(controller);
  return app.scheduled({
    ...controller,
    cron: SAKURAZAKA_CRON,
    scheduledTime: scheduledAt,
  }, env);
}

export async function runSakurazakaFollowersQueue(batch, env) {
  const messages = batch?.messages || [];
  for (const message of messages) {
    if (message?.body?.message_type === STATIONHEAD_DAILY_FOLLOWERS_MESSAGE) {
      // Drain any retry that was queued before the collection path moved to
      // GitHub Actions. The scheduled Action owns future daily snapshots.
      console.log(JSON.stringify({
        event: 'stationhead_daily_followers_legacy_queue_drained',
        scheduled_at: Number(message?.body?.scheduled_at) || null,
      }));
      message.ack();
      continue;
    }
    await app.queue({ ...batch, messages: [message] }, env);
  }
}

export default {
  scheduled: runSakurazakaFollowersScheduled,
  queue: runSakurazakaFollowersQueue,
  fetch: app.fetch,
};
