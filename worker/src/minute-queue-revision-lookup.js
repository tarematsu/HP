// Preserve the existing complete-first, newest-first lookup across revision paths.
export function findReusableQueueRevision(db, input, { extended = false } = {}) {
  const columns = extended
    ? 'id,status,effective_at,item_count,materialized_item_count,coverage_complete,source_job_id,source_visible_count'
    : 'id,status,effective_at,item_count';
  return db.prepare(`SELECT ${columns} FROM sh_queue_revisions
    WHERE channel_id=? AND structural_hash=? AND session_id IS ? AND queue_start_time IS ?
      AND status IN ('complete','pending')
    ORDER BY CASE status WHEN 'complete' THEN 0 ELSE 1 END,effective_at DESC,id DESC
    LIMIT 1`)
    .bind(input.channelId, input.structuralHash, input.sessionId, input.queueStart)
    .first();
}

// Exact fallback for a revision already inserted at this observation time.
export function findStoredQueueRevision(db, input) {
  return db.prepare(`SELECT id,status,effective_at,item_count,materialized_item_count,
      coverage_complete,source_job_id,source_visible_count
    FROM sh_queue_revisions
    WHERE channel_id=? AND effective_at=? AND structural_hash=?
    LIMIT 1`)
    .bind(input.channelId, input.observedAt, input.structuralHash)
    .first();
}
