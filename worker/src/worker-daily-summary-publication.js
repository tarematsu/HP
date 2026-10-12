import { publishRecentDailySummaries } from './recent-daily-summary-publication.js';

// Worker-native entrypoint. Reuse the same bounded, idempotent publication
// logic as the legacy Actions command; do not perform remote Wrangler calls.
export async function publishRecentDailySummariesFromWorker(env, now = Date.now()) {
  const minuteDb = env?.MINUTE_DB;
  const otherDb = env?.OTHER_DB;
  if (!minuteDb?.prepare || !otherDb?.prepare) {
    return { skipped: true, reason: 'db-binding-missing', published: [], unavailable: [] };
  }
  return publishRecentDailySummaries(minuteDb, otherDb, now, 7);
}
