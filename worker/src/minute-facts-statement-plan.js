import { minuteFactContextDeleteStatement } from './minute-facts-normalize.js';
import { totalMemberDailyChangeStatement } from './minute-facts-daily-state.js';
import {
  guardedMinuteFactContextUpsertStatement,
  guardedMinuteFactStatement,
} from './minute-facts-write-guards.js';

const DASHBOARD_BUCKET_MS = 5 * 60_000;

function contextPresent(fact) {
  return fact.queue_revision_id != null
    || Number(fact.queue_available || 0) !== 0
    || fact.queue_position != null
    || fact.broadcast_session_id == null;
}

function completedDashboardBucket(minuteAt) {
  if (!Number.isFinite(minuteAt)) return null;
  return Math.floor(minuteAt / DASHBOARD_BUCKET_MS) * DASHBOARD_BUCKET_MS - DASHBOARD_BUCKET_MS;
}

export function dashboardHistoryRollupStatement(db, fact) {
  if (Number(fact?.source_code) !== 1) return db.prepare('SELECT 1 WHERE 0');
  const bucketAt = completedDashboardBucket(Number(fact?.minute_at));
  if (bucketAt == null) return db.prepare('SELECT 1 WHERE 0');
  const bucketEnd = bucketAt + DASHBOARD_BUCKET_MS;
  return db.prepare(`WITH bucket_facts AS (
      SELECT f.id,f.channel_id,f.minute_at,f.observed_at,
        f.listener_count,f.online_member_count,f.total_member_count,
        f.reported_total_listens AS total_listens,
        f.reported_current_stream_count AS current_stream_count
      FROM sh_minute_facts AS f
        INDEXED BY idx_sh_minute_facts_source_channel_minute_desc
      WHERE f.source_code=1 AND f.channel_id=?
        AND f.minute_at>=? AND f.minute_at<?
    ), latest AS (
      SELECT * FROM bucket_facts
      ORDER BY minute_at DESC,id DESC
      LIMIT 1
    )
    INSERT INTO sh_dashboard_history_5m(
      channel_id,bucket_at,fact_id,minute_at,observed_at,
      listener_count,online_member_count,total_member_count,total_listens,
      current_stream_count
    )
    SELECT channel_id,?,id,minute_at,observed_at,
      listener_count,online_member_count,total_member_count,total_listens,
      current_stream_count
    FROM latest
    WHERE TRUE
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
    .bind(fact.channel_id, bucketAt, bucketEnd, bucketAt);
}

export function minuteFactStatements(db, fact) {
  return [
    guardedMinuteFactStatement(db, fact),
    dashboardHistoryRollupStatement(db, fact),
    totalMemberDailyChangeStatement(db, fact),
    contextPresent(fact)
      ? guardedMinuteFactContextUpsertStatement(db, fact)
      : minuteFactContextDeleteStatement(db, fact),
  ];
}
