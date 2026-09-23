import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { materializeWeeklyRankingReadModel } from './materialize-weekly-ranking-read-model.mjs';
import { createWranglerRemoteD1 } from './remote-d1-adapter.mjs';

const RANKING_TYPE = '週間リーダーボード';
const CHUNK_STORAGE = 'chunked-json-v1';

function finiteInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : 0;
}

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

function chunkPointer(payloadJson) {
  try {
    const value = JSON.parse(String(payloadJson || ''));
    if (value?.storage !== CHUNK_STORAGE) return null;
    const generationId = String(value.generation_id || '').trim();
    const chunkCount = finiteInteger(value.chunk_count);
    if (!generationId || chunkCount < 1) return null;
    return { generationId, chunkCount };
  } catch {
    return null;
  }
}

export function sourceRevision(source) {
  if (!validDate(source?.max_ranking_date)) return null;
  return [
    source.max_ranking_date,
    finiteInteger(source.max_ranking_imported_at),
    finiteInteger(source.max_weekly_summary_updated_at),
    finiteInteger(source.max_fandom_verified_at),
  ].join(':');
}

export function shouldRefreshWeeklyRankingReadModel(source, stored) {
  if (!sourceRevision(source)) return false;
  if (!stored) return true;
  if (String(stored.source_max_ranking_date || '') !== source.max_ranking_date) return true;
  if (stored.chunk_complete !== true) return true;
  const sourceUpdatedAt = Math.max(
    finiteInteger(source.max_ranking_imported_at),
    finiteInteger(source.max_weekly_summary_updated_at),
    finiteInteger(source.max_fandom_verified_at),
  );
  return finiteInteger(stored.refreshed_at) < sourceUpdatedAt;
}

export async function loadWeeklyRankingSourceRevision(db) {
  const [ranking, weekly, fandom] = await Promise.all([
    db.prepare(`SELECT MAX(ranking_date) AS max_ranking_date,
      COALESCE(MAX(imported_at),0) AS max_ranking_imported_at
      FROM sh_channel_rankings
      WHERE ranking_type=?`).bind(RANKING_TYPE).first(),
    db.prepare(`SELECT COALESCE(MAX(updated_at),0) AS max_weekly_summary_updated_at
      FROM sh_weekly_summary`).first(),
    db.prepare(`SELECT COALESCE(MAX(verified_at),0) AS max_fandom_verified_at
      FROM sh_channel_fandoms`).first(),
  ]);
  return {
    max_ranking_date: String(ranking?.max_ranking_date || ''),
    max_ranking_imported_at: finiteInteger(ranking?.max_ranking_imported_at),
    max_weekly_summary_updated_at: finiteInteger(weekly?.max_weekly_summary_updated_at),
    max_fandom_verified_at: finiteInteger(fandom?.max_fandom_verified_at),
  };
}

export async function loadWeeklyRankingReadModelState(db) {
  let stored;
  try {
    stored = await db.prepare(`SELECT source_max_ranking_date,payload_json,refreshed_at
      FROM sh_weekly_ranking_read_model
      WHERE id=1`).first();
  } catch (error) {
    if (/no such table/i.test(String(error?.message || ''))) return null;
    throw error;
  }
  if (!stored) return null;

  const pointer = chunkPointer(stored.payload_json);
  let chunkComplete = false;
  if (pointer) {
    const count = await db.prepare(`SELECT COUNT(*) AS chunk_count
      FROM sh_weekly_ranking_read_model_chunks
      WHERE generation_id=?`).bind(pointer.generationId).first();
    chunkComplete = finiteInteger(count?.chunk_count) === pointer.chunkCount;
  }
  return {
    source_max_ranking_date: String(stored.source_max_ranking_date || ''),
    refreshed_at: finiteInteger(stored.refreshed_at),
    chunk_complete: chunkComplete,
  };
}

async function invalidateSameSourceRevision(db, source, stored) {
  if (!stored || stored.source_max_ranking_date !== source.max_ranking_date) return false;
  await db.prepare(`UPDATE sh_weekly_ranking_read_model
    SET source_max_ranking_date=NULL
    WHERE id=1`).run();
  return true;
}

export async function refreshWeeklyRankingReadModelIfStale(db, now = Date.now(), dependencies = {}) {
  const loadSource = dependencies.loadSourceRevision || loadWeeklyRankingSourceRevision;
  const loadStored = dependencies.loadReadModelState || loadWeeklyRankingReadModelState;
  const materialize = dependencies.materialize || materializeWeeklyRankingReadModel;
  const invalidate = dependencies.invalidate || invalidateSameSourceRevision;

  const source = await loadSource(db);
  const revision = sourceRevision(source);
  if (!revision) {
    return { status: 'skipped', reason: 'no-ranking-source', source_revision: null };
  }
  const stored = await loadStored(db);
  if (!shouldRefreshWeeklyRankingReadModel(source, stored)) {
    return {
      status: 'unchanged',
      reason: 'source-revision-current',
      source_revision: revision,
      source_max_ranking_date: source.max_ranking_date,
      refreshed_at: finiteInteger(stored?.refreshed_at) || null,
    };
  }

  // The underlying materializer historically used source_max_ranking_date as its
  // first freshness check. Invalidate that marker when the same week changed so
  // corrections, weekly-summary changes, fandom changes, and broken chunks force
  // a full rebuild instead of being mistaken for an unchanged model.
  await invalidate(db, source, stored);
  const result = await materialize(db, now);
  return {
    ...result,
    source_revision: revision,
    source_max_ranking_date: result.source_max_ranking_date || source.max_ranking_date,
  };
}

function appendSummary(result) {
  if (!process.env.GITHUB_STEP_SUMMARY) return;
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, [
    '## Weekly leaderboard read model freshness',
    '',
    `- status: \`${result.status}\``,
    `- reason: \`${result.reason || ''}\``,
    `- source revision: \`${result.source_revision || ''}\``,
    `- source week: \`${result.source_max_ranking_date || ''}\``,
    `- refreshed_at: \`${result.refreshed_at || ''}\``,
    '',
  ].join('\n'));
}

export async function main() {
  const workerRoot = resolve(import.meta.dirname, '..');
  const wranglerScript = resolve(workerRoot, 'node_modules/wrangler/bin/wrangler.js');
  const db = createWranglerRemoteD1({
    database: process.env.OTHER_DATABASE_NAME || 'stationhead-other',
    cwd: workerRoot,
    wranglerScript,
  });
  const result = await refreshWeeklyRankingReadModelIfStale(db);
  appendSummary(result);
  console.log(JSON.stringify(result));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
}
