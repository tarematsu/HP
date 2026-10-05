export async function loadReadModelRevisions(db, keys) {
  const selected = [...new Set((keys || []).map(String).filter(Boolean))];
  if (!selected.length || typeof db?.prepare !== 'function') return new Map();
  const placeholders = selected.map(() => '?').join(',');
  const result = await db.prepare(`SELECT model_key,revision,updated_at
    FROM sh_read_model_revision WHERE model_key IN (${placeholders})`)
    .bind(...selected).all();
  return new Map((result?.results || []).map((row) => [
    String(row.model_key),
    { revision: Number(row.revision) || 0, updated_at: Number(row.updated_at) || 0 },
  ]));
}

export function readModelRevisionToken(revisions, key) {
  const row = revisions?.get?.(key);
  return `${Number(row?.revision) || 0}:${Number(row?.updated_at) || 0}`;
}

export async function bumpReadModelRevision(db, key, now = Date.now()) {
  if (typeof db?.prepare !== 'function' || !String(key || '').trim()) return false;
  await db.prepare(`INSERT INTO sh_read_model_revision(model_key,revision,updated_at)
    VALUES(?,1,?)
    ON CONFLICT(model_key) DO UPDATE SET revision=revision+1,updated_at=excluded.updated_at`)
    .bind(String(key), Number(now) || Date.now()).run();
  return true;
}
