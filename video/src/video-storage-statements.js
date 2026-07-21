import { makePayloadChunks } from './d1-payload-chunks.js';

export const VIDEO_STORAGE_BATCH_SIZE = 40;

export function videoItemPayloads(items) {
  return makePayloadChunks(items).map((chunk) => JSON.stringify(chunk));
}

export function countExistingVideoItemsStatement(db, payload) {
  return db.prepare(
    `SELECT COUNT(*) AS count FROM videos
     WHERE canonical_key IN (
       SELECT json_extract(value, '$.key') FROM json_each(?)
     )`
  ).bind(payload);
}

function baseVideoUpsertSql({ conditional, returningInserted }) {
  return `WITH incoming AS (
     SELECT json_extract(value, '$.url') AS mediaUrl,
            json_extract(value, '$.key') AS canonicalKey,
            json_extract(value, '$.type') AS mediaType
       FROM json_each(?)
   )
   INSERT INTO videos (
     media_url, canonical_key, media_type, first_seen_at, last_seen_at
   )
   SELECT mediaUrl, canonicalKey, mediaType, ?, ? FROM incoming
   WHERE 1
   ON CONFLICT(canonical_key) DO UPDATE SET
     media_url = excluded.media_url,
     media_type = excluded.media_type,
     last_seen_at = excluded.last_seen_at,
     fail_count = 0,
     status = CASE WHEN videos.status = 'hidden' THEN 'hidden' ELSE 'active' END${conditional ? `
   WHERE videos.media_url IS NOT excluded.media_url
      OR videos.media_type IS NOT excluded.media_type
      OR videos.fail_count <> 0
      OR videos.status NOT IN ('active','hidden')
      OR videos.last_seen_at < ?` : ''}${returningInserted ? `
   RETURNING CASE WHEN first_seen_at = ? THEN 1 ELSE 0 END AS inserted` : ''}`;
}

export function upsertVideoItemsStatement(db, payload, capturedAt, options = {}) {
  const {
    sessionStart = null,
    conditional = false,
    returningInserted = false
  } = options;
  const statement = db.prepare(baseVideoUpsertSql({ conditional, returningInserted }));
  const bindings = [payload, capturedAt, capturedAt];
  if (conditional) bindings.push(sessionStart || capturedAt);
  if (returningInserted) bindings.push(capturedAt);
  return statement.bind(...bindings);
}

export function countInsertedRows(result) {
  return (result?.results || []).reduce(
    (sum, row) => sum + (Number(row.inserted) === 1 ? 1 : 0),
    0
  );
}
