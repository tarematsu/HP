import { publishRecentDailySummaries } from './recent-daily-summary-publication.js';

let activePublication = null;

// Worker-native entrypoint. Reuse the same bounded, idempotent publication
// logic as the legacy Actions command; do not perform remote Wrangler calls.
export function publishRecentDailySummariesFromWorker(env, now = Date.now(), dependencies = {}) {
  const minuteDb = env?.MINUTE_DB;
  const otherDb = env?.OTHER_DB;
  if (!minuteDb?.prepare || !otherDb?.prepare) {
    return Promise.resolve({ skipped: true, reason: 'db-binding-missing', published: [], unavailable: [] });
  }
  if (activePublication) return activePublication;
  const publish = dependencies.publish || publishRecentDailySummaries;
  const task = Promise.resolve().then(() => publish(minuteDb, otherDb, now, 7));
  activePublication = task.finally(() => {
    if (activePublication === task || activePublication === guarded) activePublication = null;
  });
  const guarded = activePublication;
  return guarded;
}
