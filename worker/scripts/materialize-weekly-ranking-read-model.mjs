import { Buffer } from 'node:buffer';
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createWranglerRemoteD1 } from './remote-d1-adapter.mjs';

const DAY_MS = 86_400_000;
const MODEL_VERSION = 2;
const CHUNK_STORAGE = 'chunked-json-v1';
// D1 limits each SQL statement to 100,000 bytes. Keep source chunks well below
// that so SQL quoting/escaping cannot push an INSERT over the statement limit.
const CHUNK_MAX_BYTES = 40_000;
const STATIONHEAD_CHANNEL_BY_ARTIST = new Map([
  ['櫻坂46', 'Buddies'],
  ['SixTONES', 'team SixTONES'],
  ['BTS', 'BTS ARMY'],
  ['JO1', 'JAM'],
  ['BE:FIRST', 'BESTY'],
  ['King & Prince', 'Tiara'],
  ['Stray Kids', 'STAYS'],
  ['SB19', 'ATIN'],
  ['ROSÉ', 'numberoneHQ'],
]);

function hostKey(value) {
  return String(value || '').trim().toLowerCase();
}

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

function fandomLabel(artistName, relationType) {
  const artist = String(artistName || '').trim();
  if (!artist) return null;
  return `${artist}(${relationType === 'official' ? '公式' : 'ファンダム'})`;
}

function expandWeeklyDates(values) {
  const sorted = [...new Set(values.filter(validDate))].sort();
  if (sorted.length < 2) return sorted;
  const first = Date.parse(`${sorted[0]}T00:00:00Z`);
  const last = Date.parse(`${sorted.at(-1)}T00:00:00Z`);
  if (!Number.isFinite(first) || !Number.isFinite(last)) return sorted;
  const weeks = [];
  for (let ts = first; ts <= last; ts += 7 * DAY_MS) weeks.push(new Date(ts).toISOString().slice(0, 10));
  return weeks;
}

function decorateRows(rows, fandomRows) {
  const metadata = new Map();
  for (const row of fandomRows || []) {
    const key = hostKey(row?.host_name);
    const correctedSbuddies = key === 'sbuddies1819';
    const artistName = correctedSbuddies ? 'SB19' : String(row?.artist_name || '').trim();
    if (!artistName) continue;
    metadata.set(key, {
      artist_name: artistName,
      fandom_type: correctedSbuddies ? 'fandom' : row.relation_type === 'official' ? 'official' : 'fandom',
      stationhead_channel_name: STATIONHEAD_CHANNEL_BY_ARTIST.get(artistName) || null,
    });
  }
  return (rows || []).map((row) => {
    const fandom = metadata.get(hostKey(row.host_name));
    const decorated = { ...row };
    if (fandom) {
      decorated.artist_name = fandom.artist_name;
      decorated.fandom_type = fandom.fandom_type;
      decorated.fandom_label = fandomLabel(fandom.artist_name, fandom.fandom_type);
      decorated.stationhead_channel_name = fandom.stationhead_channel_name;
    } else {
      decorated.artist_name = null;
      decorated.fandom_type = null;
      decorated.fandom_label = null;
      decorated.stationhead_channel_name = null;
    }
    return decorated;
  });
}

function uniqueHosts(rows) {
  const hosts = [];
  const seen = new Set();
  for (const row of rows || []) {
    const name = String(row?.host_name || '').trim();
    const key = hostKey(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    hosts.push(name);
  }
  return hosts;
}

function completeTimeline(actualRows, rankingWeeks) {
  const hosts = uniqueHosts(actualRows);
  const firstSeen = new Map();
  const actualByWeekHost = new Map();
  const metadataByHost = new Map();
  for (const row of actualRows) {
    const key = hostKey(row.host_name);
    const week = String(row.ranking_date || '');
    if (!validDate(week) || !key) continue;
    const previous = firstSeen.get(key);
    if (!previous || week < previous) firstSeen.set(key, week);
    actualByWeekHost.set(`${week}\u0000${key}`, row);
    if (!metadataByHost.has(key)) {
      metadataByHost.set(key, {
        artist_name: row.artist_name || null,
        fandom_type: row.fandom_type || null,
        fandom_label: row.fandom_label || null,
        stationhead_channel_name: row.stationhead_channel_name || null,
      });
    }
  }

  const completed = [];
  for (const host of hosts) {
    const key = hostKey(host);
    const first = firstSeen.get(key);
    const metadata = metadataByHost.get(key) || {};
    if (!first) continue;
    for (const week of rankingWeeks) {
      if (week < first) continue;
      const actual = actualByWeekHost.get(`${week}\u0000${key}`);
      if (actual) {
        completed.push({ ...actual, synthetic: false, is_out_of_rank: false });
        continue;
      }
      completed.push({
        ranking_date: week,
        observed_at: Date.parse(`${week}T00:00:00Z`),
        ranking_type: '週間リーダーボード',
        rank: null,
        host_name: host,
        host_alias: host,
        source_sheet: null,
        quality_score: null,
        quality_flags: 'not_listed',
        artist_name: metadata.artist_name || null,
        fandom_type: metadata.fandom_type || null,
        fandom_label: metadata.fandom_label || null,
        stationhead_channel_name: metadata.stationhead_channel_name || null,
        synthetic: true,
        is_out_of_rank: true,
      });
    }
  }
  return completed;
}

export function buildWeeklyRankingReadModel(rankingRows, fandomRows, weeklyRows, refreshedAt = Date.now()) {
  const actualRows = decorateRows((rankingRows || []).map((row) => ({ ...row })), fandomRows);
  const rankingWeeks = expandWeeklyDates(actualRows.map((row) => row.ranking_date));
  const completedRows = completeTimeline(actualRows, rankingWeeks);
  return {
    version: MODEL_VERSION,
    refreshed_at: refreshedAt,
    source_max_ranking_date: rankingWeeks.at(-1) || null,
    ranking_weeks: rankingWeeks,
    actual_rows: actualRows,
    completed_rows: completedRows,
    weekly_metrics: (weeklyRows || []).map((row) => ({ ...row })),
  };
}

export function splitUtf8String(value, maxBytes = CHUNK_MAX_BYTES) {
  const source = String(value || '');
  const limit = Math.max(1024, Math.trunc(Number(maxBytes)) || CHUNK_MAX_BYTES);
  if (!source) return [''];
  const chunks = [];
  let start = 0;
  let index = 0;
  let bytes = 0;
  while (index < source.length) {
    const codePoint = source.codePointAt(index);
    const width = codePoint > 0xFFFF ? 2 : 1;
    const charBytes = Buffer.byteLength(String.fromCodePoint(codePoint), 'utf8');
    if (bytes > 0 && bytes + charBytes > limit) {
      chunks.push(source.slice(start, index));
      start = index;
      bytes = 0;
    }
    bytes += charBytes;
    index += width;
  }
  chunks.push(source.slice(start));
  return chunks;
}

function readChunkPointer(payloadJson) {
  try {
    const value = JSON.parse(String(payloadJson || ''));
    if (value?.storage !== CHUNK_STORAGE) return null;
    const generationId = String(value.generation_id || '').trim();
    const chunkCount = Number(value.chunk_count);
    const modelVersion = Number(value.model_version) || 0;
    if (!generationId || !Number.isSafeInteger(chunkCount) || chunkCount < 1) return null;
    return { generationId, chunkCount, modelVersion };
  } catch {
    return null;
  }
}

async function ensureReadModelTable(db) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS sh_weekly_ranking_read_model (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    source_max_ranking_date TEXT,
    payload_json TEXT NOT NULL,
    refreshed_at INTEGER NOT NULL
  )`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS sh_weekly_ranking_read_model_chunks (
    generation_id TEXT NOT NULL,
    chunk_index INTEGER NOT NULL,
    payload_chunk TEXT NOT NULL,
    refreshed_at INTEGER NOT NULL,
    PRIMARY KEY(generation_id, chunk_index)
  )`).run();
}

async function existingModelIsComplete(db, existing, sourceMaxRankingDate) {
  if (!existing?.source_max_ranking_date || existing.source_max_ranking_date !== sourceMaxRankingDate) return false;
  const pointer = readChunkPointer(existing.payload_json);
  if (!pointer || pointer.modelVersion !== MODEL_VERSION) return false;
  const countRow = await db.prepare(`SELECT COUNT(*) AS chunk_count
    FROM sh_weekly_ranking_read_model_chunks
    WHERE generation_id=?`).bind(pointer.generationId).first();
  return Number(countRow?.chunk_count) === pointer.chunkCount;
}

async function runWriteScript(db, statements) {
  if (typeof db.script === 'function') return db.script(statements);
  for (const statement of statements) await statement.run();
  return null;
}

export async function materializeWeeklyRankingReadModel(db, now = Date.now()) {
  await ensureReadModelTable(db);
  const [rankingResult, fandomResult, weeklyResult, existing] = await Promise.all([
    db.prepare(`SELECT ranking_date,observed_at,ranking_type,rank,
      channel_name AS host_name,channel_alias AS host_alias,
      source_sheet,quality_score,quality_flags
      FROM sh_channel_rankings
      WHERE channel_name IS NOT NULL AND trim(channel_name)<>''
      ORDER BY ranking_date ASC,rank ASC,channel_name ASC`).all(),
    db.prepare(`SELECT host_name,artist_name,relation_type FROM sh_channel_fandoms ORDER BY host_name`).all(),
    db.prepare(`SELECT period_key,period_start,period_end,sample_count,reliable_sample_count,
      listener_avg,listener_min,listener_max,stream_start,stream_end,stream_growth,
      member_start,member_end,member_growth,likes_max,distinct_tracks,primary_host,
      quality_score,quality_flags
      FROM sh_weekly_summary ORDER BY period_key ASC`).all(),
    db.prepare('SELECT source_max_ranking_date,payload_json,refreshed_at FROM sh_weekly_ranking_read_model WHERE id=1').first(),
  ]);

  const model = buildWeeklyRankingReadModel(
    rankingResult.results || [],
    fandomResult.results || [],
    weeklyResult.results || [],
    now,
  );
  if (await existingModelIsComplete(db, existing, model.source_max_ranking_date)) {
    return {
      status: 'unchanged',
      source_max_ranking_date: model.source_max_ranking_date,
      refreshed_at: Number(existing.refreshed_at) || null,
      row_count: model.actual_rows.length,
    };
  }

  const serialized = JSON.stringify(model);
  const chunks = splitUtf8String(serialized);
  const generationId = `${now}-${model.source_max_ranking_date || 'none'}`;
  const pointerJson = JSON.stringify({
    storage: CHUNK_STORAGE,
    generation_id: generationId,
    chunk_count: chunks.length,
    payload_bytes: Buffer.byteLength(serialized, 'utf8'),
    model_version: MODEL_VERSION,
  });

  const statements = [
    db.prepare('DELETE FROM sh_weekly_ranking_read_model_chunks WHERE generation_id=?')
      .bind(generationId),
  ];
  for (let index = 0; index < chunks.length; index += 1) {
    statements.push(db.prepare(`INSERT INTO sh_weekly_ranking_read_model_chunks(
      generation_id,chunk_index,payload_chunk,refreshed_at
    ) VALUES(?,?,?,?)`).bind(generationId, index, chunks[index], now));
  }
  // Publish the small pointer only after every chunk statement. If the import fails before
  // this point, Pages keeps serving the previous generation rather than partial JSON.
  statements.push(db.prepare(`INSERT INTO sh_weekly_ranking_read_model(id,source_max_ranking_date,payload_json,refreshed_at)
    VALUES(1,?,?,?)
    ON CONFLICT(id) DO UPDATE SET
      source_max_ranking_date=excluded.source_max_ranking_date,
      payload_json=excluded.payload_json,
      refreshed_at=excluded.refreshed_at`)
    .bind(model.source_max_ranking_date, pointerJson, now));
  statements.push(db.prepare('DELETE FROM sh_weekly_ranking_read_model_chunks WHERE generation_id<>?')
    .bind(generationId));
  await runWriteScript(db, statements);

  return {
    status: 'materialized',
    source_max_ranking_date: model.source_max_ranking_date,
    refreshed_at: now,
    row_count: model.actual_rows.length,
    completed_row_count: model.completed_rows.length,
    payload_bytes: Buffer.byteLength(serialized, 'utf8'),
    chunk_count: chunks.length,
  };
}

function appendSummary(result) {
  if (!process.env.GITHUB_STEP_SUMMARY) return;
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, [
    '## Weekly leaderboard read model',
    '',
    `- status: \`${result.status}\``,
    `- source week: \`${result.source_max_ranking_date || ''}\``,
    `- actual rows: \`${result.row_count || 0}\``,
    `- completed rows: \`${result.completed_row_count || 0}\``,
    `- payload bytes: \`${result.payload_bytes || 0}\``,
    `- chunks: \`${result.chunk_count || 0}\``,
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
  const result = await materializeWeeklyRankingReadModel(db);
  appendSummary(result);
  console.log(JSON.stringify(result));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
}
