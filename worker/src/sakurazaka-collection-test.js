const DEFAULT_DURATION_MS = 5 * 60 * 1000;

const CREATE_TABLE_SQL = `CREATE TABLE IF NOT EXISTS sh_sakurazaka46jp_collection_tests (
  test_id TEXT PRIMARY KEY,
  target_handle TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  ends_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  updated_at INTEGER NOT NULL
)`;

function positive(value, fallback, maximum = Number.MAX_SAFE_INTEGER) {
  const number = Math.trunc(Number(value));
  if (!Number.isFinite(number) || number <= 0) return fallback;
  return Math.min(number, maximum);
}

export function sakurazakaCollectionTestConfig(env = {}) {
  const testId = String(env.SAKURAZAKA_COLLECTION_TEST_ID || '').trim();
  const targetHandle = String(env.SAKURAZAKA_COLLECTION_TEST_HANDLE || '').trim().toLowerCase();
  return {
    enabled: Boolean(testId && targetHandle),
    testId,
    targetHandle,
    durationMs: positive(env.SAKURAZAKA_COLLECTION_TEST_DURATION_MS, DEFAULT_DURATION_MS, 30 * 60 * 1000),
  };
}

export async function sakurazakaCollectionTestWindow(env, now) {
  const cfg = sakurazakaCollectionTestConfig(env);
  if (!cfg.enabled) return { ...cfg, active: false, status: 'disabled' };
  if (!env?.OTHER_DB?.prepare) throw new Error('OTHER_DB binding is unavailable for collection test');

  await env.OTHER_DB.prepare(CREATE_TABLE_SQL).run();
  await env.OTHER_DB.prepare(`INSERT OR IGNORE INTO sh_sakurazaka46jp_collection_tests
      (test_id,target_handle,started_at,ends_at,status,updated_at)
    VALUES (?,?,?,?, 'running', ?)`)
    .bind(cfg.testId, cfg.targetHandle, now, now + cfg.durationMs, now)
    .run();

  let row = await env.OTHER_DB.prepare(`SELECT test_id,target_handle,started_at,ends_at,status,updated_at
    FROM sh_sakurazaka46jp_collection_tests WHERE test_id=? LIMIT 1`)
    .bind(cfg.testId).first();
  if (!row) throw new Error('collection test state could not be initialized');

  if (row.status === 'running' && now >= Number(row.ends_at)) {
    await env.OTHER_DB.prepare(`UPDATE sh_sakurazaka46jp_collection_tests
      SET status='completed',updated_at=? WHERE test_id=? AND status='running'`)
      .bind(now, cfg.testId).run();
    row = { ...row, status: 'completed', updated_at: now };
  }

  return {
    enabled: true,
    active: row.status === 'running' && now < Number(row.ends_at),
    testId: row.test_id,
    targetHandle: row.target_handle,
    startedAt: Number(row.started_at),
    endsAt: Number(row.ends_at),
    status: row.status,
    updatedAt: Number(row.updated_at),
  };
}
