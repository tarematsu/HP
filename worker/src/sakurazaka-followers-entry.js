import app, { SAKURAZAKA_CRON } from './sakurazaka-entry.js';
import {
  collectStationheadDailyFollowers,
  isJstMidnightMinute,
} from './stationhead-daily-followers.js';

export const STATIONHEAD_DAILY_FOLLOWERS_MESSAGE = 'stationhead-daily-followers';
const JSON_QUEUE_SEND_OPTIONS = Object.freeze({ contentType: 'json' });
const RETRY_60_SECONDS = Object.freeze({ delaySeconds: 60 });

function scheduledTimestamp(controller) {
  const value = Number(controller?.scheduledTime);
  return Number.isFinite(value) ? value : Date.now();
}

function dailyFollowersBody(scheduledAt) {
  return {
    message_type: STATIONHEAD_DAILY_FOLLOWERS_MESSAGE,
    message_version: 1,
    scheduled_at: scheduledAt,
  };
}

async function dispatchDailyFollowers(env, scheduledAt) {
  if (!env?.SAKURAZAKA_QUEUE?.send) throw new Error('SAKURAZAKA_QUEUE binding is missing');
  await env.SAKURAZAKA_QUEUE.send(dailyFollowersBody(scheduledAt), JSON_QUEUE_SEND_OPTIONS);
}

export async function runSakurazakaFollowersScheduled(controller, env) {
  const cron = String(controller?.cron || '');
  const scheduledAt = scheduledTimestamp(controller);
  let dailyFollowersDispatched = false;

  // The existing minute cron is reused. This time-only gate performs no D1 read
  // and therefore adds effectively no database cost during the other 1,439
  // invocations each JST day.
  if (cron === SAKURAZAKA_CRON && isJstMidnightMinute(scheduledAt)) {
    await dispatchDailyFollowers(env, scheduledAt);
    dailyFollowersDispatched = true;
  }

  const result = await app.scheduled(controller, env);
  return dailyFollowersDispatched
    ? { ...result, daily_followers_dispatched: true }
    : result;
}

async function processDailyFollowersMessage(message, env) {
  const body = message?.body || {};
  if (Number(body.message_version) !== 1) throw new Error('unsupported daily followers task version');
  const scheduledAt = Number(body.scheduled_at);
  if (!Number.isFinite(scheduledAt)) throw new Error('daily followers timestamp is invalid');
  const result = await collectStationheadDailyFollowers(env, scheduledAt);
  console.log(JSON.stringify({
    event: 'stationhead_daily_followers_collected',
    ...result,
  }));
  return result;
}

export async function runSakurazakaFollowersQueue(batch, env) {
  const messages = batch?.messages || [];
  for (const message of messages) {
    if (message?.body?.message_type !== STATIONHEAD_DAILY_FOLLOWERS_MESSAGE) {
      // Production max_batch_size is 1, but delegating one message at a time also
      // keeps this wrapper correct if that setting changes later.
      await app.queue({ ...batch, messages: [message] }, env);
      continue;
    }
    try {
      await processDailyFollowersMessage(message, env);
      message.ack();
    } catch (error) {
      console.error(JSON.stringify({
        event: 'stationhead_daily_followers_failed',
        error: String(error?.message || error).slice(0, 800),
      }));
      message.retry(RETRY_60_SECONDS);
    }
  }
}

export default {
  scheduled: runSakurazakaFollowersScheduled,
  queue: runSakurazakaFollowersQueue,
  fetch: app.fetch,
};
