import app from './sakurazaka-entry.js';

export const STATIONHEAD_DAILY_FOLLOWERS_MESSAGE = 'stationhead-daily-followers';

export async function runSakurazakaFollowersScheduled(controller, env) {
  // Daily follower collection now runs in GitHub Actions at 00:00 JST.
  // Keep this wrapper as a pass-through so the production Worker no longer
  // dispatches a task that can hit Stationhead's 401 response from Worker fetch.
  return app.scheduled(controller, env);
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
