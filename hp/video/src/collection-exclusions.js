const ORIENTATION_PAYLOAD_SIZE = 1000;
const ITEM_STATE_QUERY = `WITH incoming AS (
   SELECT json_extract(value, '$.key') AS canonicalKey,
          json_extract(value, '$.orientation') AS orientation
     FROM json_each(?)
 )
 SELECT incoming.canonicalKey,
        incoming.orientation,
        CASE
          WHEN excluded.canonical_key IS NOT NULL THEN 'blocked'
          WHEN death.canonical_key IS NOT NULL THEN 'death'
          ELSE 'orientation'
        END AS listType
   FROM incoming
   LEFT JOIN video_blocklist AS excluded
     ON excluded.canonical_key = incoming.canonicalKey
   LEFT JOIN video_death_list AS death
     ON death.canonical_key = incoming.canonicalKey
   LEFT JOIN video_orientations AS saved
     ON saved.canonical_key = incoming.canonicalKey
  WHERE excluded.canonical_key IS NOT NULL
     OR death.canonical_key IS NOT NULL
     OR saved.canonical_key IS NULL
     OR saved.orientation IS NOT incoming.orientation`;
const ORIENTATION_UPSERT = `WITH incoming AS (
   SELECT json_extract(value, '$.key') AS canonicalKey,
          json_extract(value, '$.orientation') AS orientation
     FROM json_each(?)
 )
 INSERT INTO video_orientations (canonical_key, orientation)
 SELECT incoming.canonicalKey, incoming.orientation
   FROM incoming
  WHERE 1
 ON CONFLICT(canonical_key) DO UPDATE SET
   orientation = excluded.orientation
 WHERE video_orientations.orientation IS NOT excluded.orientation`;

function orientationPayloads(items) {
  const payloads = [];
  for (let offset = 0; offset < items.length; offset += ORIENTATION_PAYLOAD_SIZE) {
    payloads.push(JSON.stringify(
      items.slice(offset, offset + ORIENTATION_PAYLOAD_SIZE).map((item) => ({
        key: item.key,
        orientation: item.orientation
      }))
    ));
  }
  return payloads;
}

export async function filterExcludedItems(db, items) {
  if (!items.length) return { items: [], blockedCount: 0, deathCount: 0 };

  const stateStatements = orientationPayloads(items)
    .map((payload) => db.prepare(ITEM_STATE_QUERY).bind(payload));
  const stateResults = await db.batch(stateStatements);

  const blockedKeys = new Set();
  const deathKeys = new Set();
  const orientationItems = [];
  for (const result of stateResults) {
    for (const row of result?.results || []) {
      if (row.listType === 'blocked') blockedKeys.add(row.canonicalKey);
      else if (row.listType === 'death') deathKeys.add(row.canonicalKey);
      else if (row.listType === 'orientation') {
        orientationItems.push({
          key: row.canonicalKey,
          orientation: row.orientation
        });
      }
    }
  }

  if (orientationItems.length) {
    const writes = orientationPayloads(orientationItems)
      .map((payload) => db.prepare(ORIENTATION_UPSERT).bind(payload));
    await db.batch(writes);
  }

  let blockedCount = 0;
  let deathCount = 0;
  const eligible = [];
  for (const item of items) {
    if (blockedKeys.has(item.key)) {
      blockedCount += 1;
    } else if (deathKeys.has(item.key)) {
      deathCount += 1;
    } else {
      eligible.push(item);
    }
  }
  return { items: eligible, blockedCount, deathCount };
}
