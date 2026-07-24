import { createJsonKeyPayloads } from './key-payloads.js';

export function ensureVideoDeathListTable() {
  return undefined;
}

function uniqueLookupItems(items) {
  const lookupItems = [];
  const seenKeys = new Set();
  for (const item of items) {
    const key = String(item?.key || '');
    if (!key || seenKeys.has(key)) continue;
    seenKeys.add(key);
    lookupItems.push({ key });
  }
  return lookupItems;
}

export async function filterDeathItems(db, items) {
  const sourceItems = Array.isArray(items) ? items : [];
  if (!sourceItems.length) return { items: [], deathCount: 0 };

  const payloads = createJsonKeyPayloads(uniqueLookupItems(sourceItems));
  if (!payloads.length) return { items: sourceItems, deathCount: 0 };

  const statements = payloads.map((payload) => (
    db.prepare(
      `SELECT canonical_key AS canonicalKey
         FROM video_death_list
        WHERE canonical_key IN (SELECT value FROM json_each(?))`
    ).bind(payload)
  ));
  const results = statements.length === 1
    ? [await statements[0].all()]
    : await db.batch(statements);
  const deathKeys = new Set(
    results.flatMap((result) => result?.results || []).map((row) => row.canonicalKey)
  );

  const filtered = [];
  let deathCount = 0;
  for (const item of sourceItems) {
    if (deathKeys.has(item.key)) {
      deathCount += 1;
    } else {
      filtered.push(item);
    }
  }

  return {
    items: filtered,
    deathCount
  };
}
