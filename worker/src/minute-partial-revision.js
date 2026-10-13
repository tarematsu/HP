import { queueRevisionItemStatement } from './minute-facts-normalize.js';
import { loadQueueRevisionPositions, resolveMissingQueueRevisionTracks } from './minute-queue-revision-progress.js';
import { insertPendingQueueRevision } from './minute-queue-revision-insert.js';
import {
  minuteBucket,
  queueStructuralHash,
  queueStructurePayload,
  timestampMs,
} from './minute-facts-store.js';
import { integer } from './minute-facts-track-descriptor.js';
import {
  batchRun,
  timedStage,
} from './minute-facts-track-resolution.js';
import { resolveTracksAliasFirst } from './minute-track-resolution-optimized.js';

async function findReusableRevision(db, input) {
  return db.prepare(`SELECT r.id,r.status,r.effective_at,r.item_count,
      COALESCE(r.materialized_item_count,0) AS materialized_item_count
    FROM sh_queue_revisions r
    WHERE r.channel_id=? AND r.structural_hash=? AND r.session_id IS ? AND r.queue_start_time IS ?
      AND r.status IN ('complete','pending')
    ORDER BY CASE r.status WHEN 'complete' THEN 0 ELSE 1 END,r.effective_at DESC,r.id DESC
    LIMIT 1`)
    .bind(input.channelId, input.structuralHash, input.sessionId, input.queueStart)
    .first();
}

async function updateRevisionCoverage(db, revisionId, materializedCount, totalCount) {
  const complete = materializedCount >= totalCount ? 1 : 0;
  try {
    await db.prepare(`UPDATE sh_queue_revisions SET
        item_count=MAX(item_count,?),
        materialized_item_count=MAX(COALESCE(materialized_item_count,0),?),
        coverage_complete=?,status='complete'
      WHERE id=? AND (
        item_count<? OR COALESCE(materialized_item_count,0)<?
        OR coverage_complete IS NOT ? OR status IS NOT 'complete'
      )`)
      .bind(
        totalCount,
        materializedCount,
        complete,
        revisionId,
        totalCount,
        materializedCount,
        complete,
      )
      .run();
  } catch (error) {
    if (!/no such column/i.test(String(error?.message || ''))) throw error;
    await db.prepare(`UPDATE sh_queue_revisions SET item_count=MAX(item_count,?),status='complete'
      WHERE id=? AND (item_count<? OR status IS NOT 'complete')`)
      .bind(totalCount, revisionId, totalCount)
      .run();
  }
}

export async function createPartialRevision(db, oldDb, input) {
  const { channelId, stationId, sessionId, queue, observedAt, receivedAt } = input;
  const payload = queueStructurePayload(queue);
  const structuralHash = await queueStructuralHash(queue, payload);
  const queueStart = timestampMs(queue?.start_time);
  const visibleCount = payload.tracks.length;
  const totalCount = Math.max(
    visibleCount,
    integer(queue?.total_track_count) ?? visibleCount,
  );
  const context = {
    channelId,
    minuteAt: minuteBucket(observedAt),
    queueTracks: visibleCount,
    revisionId: null,
  };

  let revision = await timedStage('find_queue_revision', context, () => findReusableRevision(db, {
    channelId,
    sessionId,
    queueStart,
    structuralHash,
  }));
  const created = !revision;
  const storedMaterializedCount = Number(revision?.materialized_item_count || 0);
  if (revision?.status === 'complete' && storedMaterializedCount >= visibleCount) {
    return {
      revisionId: Number(revision.id),
      created: false,
      resumed: false,
      materializedCount: storedMaterializedCount,
      totalCount,
      coverageComplete: storedMaterializedCount >= totalCount,
    };
  }

  if (!revision) {
    await timedStage('insert_queue_revision', context, () => insertPendingQueueRevision(db, {
        sessionId, channelId, stationId, queueId: integer(queue?.queue_id),
        queueStart, observedAt, receivedAt, structuralHash, itemCount: totalCount,
      }));
    revision = await findReusableRevision(db, {
      channelId,
      sessionId,
      queueStart,
      structuralHash,
    });
  }

  const revisionId = Number(revision?.id);
  if (!Number.isFinite(revisionId)) throw new Error('failed to create or resume partial queue revision');
  context.revisionId = revisionId;

  const existingResult = await timedStage('load_revision_progress', context, () => loadQueueRevisionPositions(db, revisionId));
  const existingRows = existingResult.results || [];
  const missing = await timedStage('resolve_tracks_alias_first', context, () => (
    resolveMissingQueueRevisionTracks(payload.tracks, existingRows,
      (tracks) => resolveTracksAliasFirst(db, oldDb, tracks, observedAt))
  ));
  const byPosition = new Map((queue?.tracks || []).map((track, index) => [
    integer(track?.position) ?? index,
    track,
  ]));
  const statements = missing.map((track) => queueRevisionItemStatement(
    db, revisionId, track, integer(byPosition.get(track.position)?.bite_count), { updateBite: true },
  ));
  if (statements.length) {
    await timedStage('write_revision_items', context, () => batchRun(db, statements));
  }

  const materializedCount = existingRows.length + missing.length;
  if (materializedCount < visibleCount) {
    throw new Error(`partial queue revision ${revisionId} incomplete: ${materializedCount}/${visibleCount}`);
  }
  await timedStage('complete_queue_revision', context, () => updateRevisionCoverage(
    db,
    revisionId,
    materializedCount,
    totalCount,
  ));
  return {
    revisionId,
    created,
    resumed: existingRows.length > 0,
    materializedCount,
    totalCount,
    coverageComplete: materializedCount >= totalCount,
  };
}
