const CHUNK_STORAGE = 'chunked-json-v1';

const CHUNK_SQL = `SELECT payload_chunk
FROM sh_weekly_ranking_read_model_chunks
WHERE generation_id=?
ORDER BY chunk_index ASC`;

function parsePointer(payloadJson) {
  try {
    const parsed = JSON.parse(String(payloadJson || ''));
    if (parsed?.storage !== CHUNK_STORAGE) return null;
    const generationId = String(parsed.generation_id || '').trim();
    const chunkCount = Number(parsed.chunk_count);
    if (!generationId || !Number.isSafeInteger(chunkCount) || chunkCount < 1) return null;
    return { parsed, generationId, chunkCount };
  } catch {
    return null;
  }
}

export async function loadWeeklyRankingReadModel(db, stored) {
  if (!stored?.payload_json) return null;
  const pointer = parsePointer(stored.payload_json);
  if (!pointer) {
    try {
      return JSON.parse(stored.payload_json);
    } catch {
      return null;
    }
  }

  const result = await db.prepare(CHUNK_SQL).bind(pointer.generationId).all();
  const rows = result?.results || [];
  if (rows.length !== pointer.chunkCount) return null;
  const payload = rows.map((row) => String(row?.payload_chunk || '')).join('');
  try {
    return JSON.parse(payload);
  } catch {
    return null;
  }
}
