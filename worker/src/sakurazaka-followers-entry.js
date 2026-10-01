import app from './sakurazaka-entry.js';
import { dispatchScheduledService } from './internal-scheduled-dispatch.js';
import { enqueueRegionalMusicDispatch } from './regional-music-dispatch-plan.js';

export const STATIONHEAD_DAILY_FOLLOWERS_MESSAGE = 'stationhead-daily-followers';
export const SHARED_STATIONHEAD_CRON = '* * * * *';
const NOGIZAKA_CRON = '* * * * *';
const OHISAMA_CRON = '*/5 * * * *';
const SPOTIFY_PLAYCOUNT_CRON = '0 * * * *';

function scheduledTimestamp(controller) {
  const value = Number(controller?.scheduledTime);
  return Number.isFinite(value) && value >= 0 ? value : Date.now();
}

function utcMinute(timestamp) {
  return new Date(timestamp).getUTCMinutes();
}

async function runSharedTargets(env, scheduledAt) {
  const minute = utcMinute(scheduledAt);
  const tasks = [
    ['nogizaka46smej', dispatchScheduledService(env?.NOGIZAKA_SCHEDULED, NOGIZAKA_CRON, scheduledAt)],
  ];
  // Buddies owns the 00/05/10/... slots. Run Ohisama one minute later so
  // Stationhead auth/channel requests cannot contend with the primary collector.
  if (minute % 5 === 1) {
    tasks.push(['ohisama', dispatchScheduledService(env?.OHISAMA_SCHEDULED, OHISAMA_CRON, scheduledAt)]);
  }
  if (minute === 0) {
    tasks.push(['spotify-playcount', dispatchScheduledService(env?.SPOTIFY_PLAYCOUNT_SCHEDULED, SPOTIFY_PLAYCOUNT_CRON, scheduledAt)]);
  }

  const regionalMusic = enqueueRegionalMusicDispatch(env, scheduledAt);
  tasks.push(['regional-music', regionalMusic]);

  const settled = await Promise.allSettled(tasks.map(([, promise]) => promise));
  const failures = [];
  const results = {};
  settled.forEach((result, index) => {
    const name = tasks[index][0];
    if (result.status === 'fulfilled') {
      results[name] = result.value;
      return;
    }
    failures.push({ name, error: String(result.reason?.message || result.reason).slice(0, 800) });
  });

  if (failures.length) {
    console.error(JSON.stringify({
      event: 'shared_stationhead_schedule_failed',
      scheduled_at: scheduledAt,
      failures,
    }));
    throw new AggregateError(
      failures.map(({ error }) => new Error(error)),
      `shared Stationhead schedule failed: ${failures.map(({ name }) => name).join(', ')}`,
    );
  }
  return results;
}

export async function runSakurazakaFollowersScheduled(controller, env) {
  // Daily follower collection now runs in GitHub Actions at 00:00 JST.
  // This minute cron is also the shared scheduler for lightweight collectors
  // and for the one-per-minute regional-music queue dispatch.
  const scheduledAt = scheduledTimestamp(controller);
  const ownController = {
    ...controller,
    cron: SHARED_STATIONHEAD_CRON,
    scheduledTime: scheduledAt,
  };
  const [sakurazaka, shared] = await Promise.all([
    app.scheduled(ownController, env),
    runSharedTargets(env, scheduledAt),
  ]);
  return { sakurazaka, shared, scheduled_at: scheduledAt };
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
