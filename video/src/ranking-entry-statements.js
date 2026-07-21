import { makePayloadChunks } from './d1-payload-chunks.js';
import { PERIOD } from './source-feed-run-records.js';

export function rankingEntryPayloads(items) {
  return makePayloadChunks(items).map((chunk) => JSON.stringify(chunk));
}

export function currentRankingEntriesStatement(db) {
  return db.prepare(
    `SELECT video_id AS videoId, rank
       FROM ranking_entries
      WHERE period = ?`
  ).bind(PERIOD);
}

export function deleteAllRankingEntriesStatement(db) {
  return db.prepare('DELETE FROM ranking_entries WHERE period = ?').bind(PERIOD);
}

export function deleteRankingEntriesByVideoIdsStatement(db, payload) {
  return db.prepare(
    `DELETE FROM ranking_entries
      WHERE period = ?
        AND video_id IN (
          SELECT CAST(json_extract(value, '$.videoId') AS INTEGER)
            FROM json_each(?)
        )`
  ).bind(PERIOD, payload);
}

export function parkRankingEntriesByVideoIdsStatement(db, payload) {
  return db.prepare(
    `UPDATE ranking_entries
        SET rank = -video_id
      WHERE period = ?
        AND video_id IN (
          SELECT CAST(json_extract(value, '$.videoId') AS INTEGER)
            FROM json_each(?)
        )`
  ).bind(PERIOD, payload);
}

export function upsertRankingEntriesByVideoIdsStatement(db, payload, capturedAt) {
  return db.prepare(
    `INSERT INTO ranking_entries (period, video_id, rank, captured_at)
     SELECT ?,
            CAST(json_extract(value, '$.videoId') AS INTEGER),
            CAST(json_extract(value, '$.rank') AS INTEGER),
            ?
       FROM json_each(?)
      WHERE 1
     ON CONFLICT(period, video_id) DO UPDATE SET
       rank = excluded.rank,
       captured_at = excluded.captured_at
     WHERE ranking_entries.rank <> excluded.rank`
  ).bind(PERIOD, capturedAt, payload);
}

export function insertRankingEntriesByCanonicalKeyStatement(db, payload, capturedAt) {
  return db.prepare(
    `INSERT INTO ranking_entries (period, video_id, rank, captured_at)
     SELECT ?, v.id, CAST(json_extract(j.value, '$.rank') AS INTEGER), ?
       FROM json_each(?) AS j
       JOIN videos v ON v.canonical_key = json_extract(j.value, '$.key')
      ORDER BY CAST(json_extract(j.value, '$.rank') AS INTEGER)`
  ).bind(PERIOD, capturedAt, payload);
}
