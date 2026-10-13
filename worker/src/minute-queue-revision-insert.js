// Shared idempotent creation of a queue revision. Preserve distinct live,
// reconstructed, and materialized schemas while centralizing SQL construction.
export function insertPendingQueueRevision(db, {
  sessionId, channelId, stationId, queueId, queueStart,
  observedAt, receivedAt, structuralHash, itemCount,
  source = 'live_collector', sourcePriority = 100,
  materialization = null,
}) {
  const extended = materialization != null;
  const columns = extended
    ? ',materialized_item_count,coverage_complete,source_job_id,source_visible_count,last_materialized_at'
    : '';
  const values = extended ? ',0,0,?,?,NULL' : '';
  const sql = `INSERT OR IGNORE INTO sh_queue_revisions(
    session_id,channel_id,station_id,queue_id,queue_start_time,effective_at,received_at,
    structural_hash,item_count,status,source,source_priority${columns}
  ) VALUES(?,?,?,?,?,?,?,?,?,'pending',?,?${values})`;
  const bindings = [sessionId, channelId, stationId, queueId, queueStart,
    observedAt, receivedAt, structuralHash, itemCount, source, sourcePriority];
  if (extended) bindings.push(materialization.sourceJobId, materialization.visibleCount);
  return db.prepare(sql).bind(...bindings).run();
}
