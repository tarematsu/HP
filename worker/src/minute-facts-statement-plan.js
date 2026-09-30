import { minuteFactContextDeleteStatement } from './minute-facts-normalize.js';
import { totalMemberDailyChangeStatement } from './minute-facts-daily-state.js';
import {
  guardedMinuteFactContextUpsertStatement,
  guardedMinuteFactStatement,
  minuteFactContextPresent,
} from './minute-facts-write-guards.js';

const DASHBOARD_BUCKET_MS = 5 * 60_000;
const TOTAL_MEMBER_HOT_CACHE_MAX = 128;
const totalMemberHotCache = new Map();

function dashboardBucket(minuteAt) {
  return Number.isFinite(minuteAt)
    ? Math.floor(minuteAt / DASHBOARD_BUCKET_MS) * DASHBOARD_BUCKET_MS
    : null;
}

function totalMemberDailyDue(fact) {
  const count = Number(fact?.total_member_count);
  if (!Number.isFinite(count) || count < 0) return false;
  if (Number(fact?.source_code) !== 1) return true;

  const minuteAt = Number(fact?.minute_at);
  const observedAt = Number(fact?.observed_at);
  const channelId = Number(fact?.channel_id);
  if (!Number.isFinite(minuteAt) || !Number.isFinite(observedAt) || !Number.isFinite(channelId)) {
    return true;
  }

  const dayAt = Math.floor(observedAt / 86_400_000) * 86_400_000;
  const hostId = Number.isFinite(Number(fact?.host_id)) && Number(fact.host_id) > 0
    ? Number(fact.host_id)
    : 0;
  const key = `${channelId}:${dayAt}:${hostId}`;
  const cachedMember = totalMemberHotCache.get(key);
  const changed = !cachedMember || cachedMember.count !== count;
  totalMemberHotCache.set(key, { count, minuteAt });

  if (totalMemberHotCache.size > TOTAL_MEMBER_HOT_CACHE_MAX) {
    const oldest = totalMemberHotCache.keys().next().value;
    if (oldest !== undefined) totalMemberHotCache.delete(oldest);
  }
  const lateRepair = observedAt - minuteAt >= DASHBOARD_BUCKET_MS;
  return changed || lateRepair;
}

export function resetMinuteFactStatementPlanCacheForTests() {
  totalMemberHotCache.clear();
}

export function dashboardHistoryRollupStatement(db, fact) {
  if (Number(fact?.source_code) !== 1) return db.prepare('SELECT 1 WHERE 0');
  const bucketAt = dashboardBucket(Number(fact?.minute_at));
  if (bucketAt == null) return db.prepare('SELECT 1 WHERE 0');
  return db.prepare(`INSERT INTO sh_dashboard_history_5m(
      channel_id,bucket_at,fact_id,minute_at,observed_at,
      listener_count,online_member_count,total_member_count,total_listens,
      current_stream_count
    )
    SELECT f.channel_id,?,f.id,f.minute_at,f.observed_at,
      f.listener_count,f.online_member_count,f.total_member_count,
      f.reported_total_listens,f.reported_current_stream_count
    FROM sh_minute_facts AS f
      INDEXED BY idx_sh_minute_facts_source_channel_minute_desc
    WHERE f.source_code=1 AND f.channel_id=? AND f.minute_at=?
    ORDER BY f.id DESC
    LIMIT 1
    ON CONFLICT(channel_id,bucket_at) DO UPDATE SET
      fact_id=excluded.fact_id,
      minute_at=excluded.minute_at,
      observed_at=excluded.observed_at,
      listener_count=excluded.listener_count,
      online_member_count=excluded.online_member_count,
      total_member_count=excluded.total_member_count,
      total_listens=excluded.total_listens,
      current_stream_count=excluded.current_stream_count
    WHERE excluded.minute_at>sh_dashboard_history_5m.minute_at
      OR (excluded.minute_at=sh_dashboard_history_5m.minute_at AND (
        excluded.fact_id IS NOT sh_dashboard_history_5m.fact_id
        OR excluded.observed_at IS NOT sh_dashboard_history_5m.observed_at
        OR excluded.listener_count IS NOT sh_dashboard_history_5m.listener_count
        OR excluded.online_member_count IS NOT sh_dashboard_history_5m.online_member_count
        OR excluded.total_member_count IS NOT sh_dashboard_history_5m.total_member_count
        OR excluded.total_listens IS NOT sh_dashboard_history_5m.total_listens
        OR excluded.current_stream_count IS NOT sh_dashboard_history_5m.current_stream_count
      ))`)
    .bind(bucketAt, fact.channel_id, fact.minute_at);
}

export function minuteFactStatements(db, fact) {
  const statements = [guardedMinuteFactStatement(db, fact)];
  if (Number(fact?.source_code) === 1) {
    statements.push(dashboardHistoryRollupStatement(db, fact));
  }
  if (totalMemberDailyDue(fact)) {
    statements.push(totalMemberDailyChangeStatement(db, fact));
  }
  statements.push(
    minuteFactContextPresent(fact)
      ? guardedMinuteFactContextUpsertStatement(db, fact)
      : minuteFactContextDeleteStatement(db, fact),
  );
  return statements;
}
