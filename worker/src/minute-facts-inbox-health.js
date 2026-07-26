import {
  MINUTE_FACT_INBOX_STATS_COMPAT_SQL,
  minuteFactInboxStats,
} from './minute-facts-inbox.js';

// Kept for compatibility with diagnostics that identify the retired aggregate
// shape. Runtime health reads must use sh_minute_fact_inbox_stats instead.
export const MINUTE_FACT_INBOX_HEALTH_SQL = MINUTE_FACT_INBOX_STATS_COMPAT_SQL;

export async function minuteFactInboxHealth(env) {
  return minuteFactInboxStats(env);
}
