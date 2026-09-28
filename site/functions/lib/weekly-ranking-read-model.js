const CHUNK_STORAGE = 'chunked-json-v1';

const CHUNK_SQL = `SELECT payload_chunk
FROM sh_weekly_ranking_read_model_chunks
WHERE generation_id=?
ORDER BY chunk_index ASC`;

let cachedGenerationId = '';
let cachedChunkCount = 0;
let cachedModel = null;

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

export function resetWeeklyRankingReadModelCache() {
  cachedGenerationId = '';
  cachedChunkCount = 0;
  cachedModel = null;
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

  if (cachedModel != null
      && cachedGenerationId === pointer.generationId
      && cachedChunkCount === pointer.chunkCount) {
    return cachedModel;
  }

  const result = await db.prepare(CHUNK_SQL).bind(pointer.generationId).all();
  const rows = result?.results || [];
  if (rows.length !== pointer.chunkCount) return null;
  const payload = rows.map((row) => String(row?.payload_chunk || '')).join('');
  try {
    const model = JSON.parse(payload);
    cachedGenerationId = pointer.generationId;
    cachedChunkCount = pointer.chunkCount;
    cachedModel = model;
    return model;
  } catch {
    return null;
  }
}
