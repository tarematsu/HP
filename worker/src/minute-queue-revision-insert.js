// Shared idempotent creation for live queue revisions. Callers retain their
// existing lookup, completion and recovery semantics.
export function insertPendingQueueRevision(db, {
  sessionId, channelId, stationId, queueId, queueStart,
  observedAt, receivedAt, structuralHash, itemCount,
}) {
  return db.prepare(`INSERT OR IGNORE INTO sh_queue_revisions(
    session_id,channel_id,station_id,queue_id,queue_start_time,effective_at,received_at,
    structural_hash,item_count,status,source,source_priority
  ) VALUES(?,?,?,?,?,?,?,?,?,'pending','live_collector',100)`)
    .bind(sessionId, channelId, stationId, queueId, queueStart,
      observedAt, receivedAt, structuralHash, itemCount)
    .run();
}
