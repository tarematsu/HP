import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWranglerRemoteD1 } from './remote-d1-adapter.mjs';

export const RANKING_TYPE = '週間リーダーボード';
export const SOURCE_SHEET = 'stationhead-r2-weekly';
export const UNIQUE_INDEX = 'uq_other_channel_rankings_week_host';

const DAY_MS = 24 * 60 * 60 * 1000;
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const EXPECTED_ROWS = 100;
const UPSERT_CHUNK_SIZE = 25;

function mondayDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return null;
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  if (date.getUTCDay() !== 1) return null;
  return value;
}

export function weeklyWindow(rankingDate) {
  const monday = mondayDate(rankingDate);
  if (!monday) return null;
  const base = Date.parse(`${monday}T00:00:00Z`);
  return {
    start: base + (18 * 60 * 60 * 1000) - JST_OFFSET_MS,
    end: base + (2 * DAY_MS) - JST_OFFSET_MS,
  };
}

function normalizeHost(value) {
  const host = String(value || '').trim().replace(/^@/, '').toLowerCase();
  return /^[a-z0-9][a-z0-9_.-]{0,63}$/.test(host) ? host : null;
}

export function validateWeeklyLeaderboardPayload(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('weekly leaderboard payload must be an object');
  }
  const rankingDate = mondayDate(value.ranking_date);
  if (!rankingDate) throw new Error('ranking_date must be a Monday YYYY-MM-DD');
  const observedAt = Number(value.observed_at);
  if (!Number.isSafeInteger(observedAt) || observedAt <= 0) throw new Error('observed_at must be an integer timestamp');
  const window = weeklyWindow(rankingDate);
  if (!window || observedAt < window.start || observedAt >= window.end) {
    throw new Error('weekly leaderboard capture is outside Monday-night-through-Tuesday JST');
  }
  const digest = String(value.digest || '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error('digest must be a SHA-256 hex string');
  if (!Array.isArray(value.rows) || value.rows.length !== EXPECTED_ROWS) {
    throw new Error(`weekly leaderboard must contain exactly ${EXPECTED_ROWS} rows`);
  }

  const rows = [];
  const hosts = new Set();
  const ranks = new Set();
  for (const raw of value.rows) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('leaderboard row must be an object');
    const rank = Number(raw.rank);
    const channelName = normalizeHost(raw.channel_name ?? raw.host ?? raw.handle ?? raw.name);
    if (!Number.isSafeInteger(rank) || rank < 1 || rank > EXPECTED_ROWS) throw new Error(`invalid leaderboard rank: ${raw.rank}`);
    if (!channelName) throw new Error(`invalid leaderboard channel: ${raw.channel_name}`);
    if (ranks.has(rank)) throw new Error(`duplicate leaderboard rank: ${rank}`);
    if (hosts.has(channelName)) throw new Error(`duplicate leaderboard channel: ${channelName}`);
    ranks.add(rank);
    hosts.add(channelName);
    rows.push({ rank, channel_name: channelName });
  }
  rows.sort((a, b) => a.rank - b.rank);
  rows.forEach((row, index) => {
    if (row.rank !== index + 1) throw new Error(`leaderboard ranks must be contiguous from 1; missing ${index + 1}`);
  });
  if (Number(value.row_count ?? rows.length) !== rows.length) throw new Error('row_count does not match rows');

  return {
    version: 1,
    ranking_date: rankingDate,
    observed_at: observedAt,
    digest,
    row_count: rows.length,
    rows,
  };
}

function rawMetadata(snapshot) {
  return JSON.stringify({
    version: 1,
    source: SOURCE_SHEET,
    digest: snapshot.digest,
    observed_at: snapshot.observed_at,
  });
}

function qualityFlags() {
  return JSON.stringify(['stationhead_r2_weekly', 'complete_snapshot']);
}

function upsertStatement(db, snapshot, row, importedAt) {
  return db.prepare(`INSERT INTO sh_channel_rankings (
    ranking_date,observed_at,ranking_type,rank,channel_name,channel_alias,
    listener_count,member_count,total_listens,source_sheet,source_row,
    quality_score,quality_flags,raw_json,imported_at
  ) VALUES (?,?,?,?,?,?,NULL,NULL,NULL,?,?,1,?,?,?)
  ON CONFLICT DO UPDATE SET
    observed_at=excluded.observed_at,
    rank=excluded.rank,
    channel_name=excluded.channel_name,
    channel_alias=CASE
      WHEN sh_channel_rankings.channel_alias IS NULL
        OR trim(sh_channel_rankings.channel_alias)=''
        OR lower(trim(sh_channel_rankings.channel_alias))=lower(trim(sh_channel_rankings.channel_name))
      THEN excluded.channel_alias
      ELSE sh_channel_rankings.channel_alias
    END,
    listener_count=NULL,
    member_count=NULL,
    total_listens=NULL,
    source_sheet=excluded.source_sheet,
    source_row=excluded.source_row,
    quality_score=excluded.quality_score,
    quality_flags=excluded.quality_flags,
    raw_json=excluded.raw_json,
    imported_at=excluded.imported_at`)
    .bind(
      snapshot.ranking_date,
      snapshot.observed_at,
      RANKING_TYPE,
      row.rank,
      row.channel_name,
      row.channel_name,
      SOURCE_SHEET,
      row.rank,
      qualityFlags(),
      rawMetadata(snapshot),
      importedAt,
    );
}

async function verifyUniqueIndex(db) {
  const row = await db.prepare(`SELECT name FROM sqlite_master WHERE type='index' AND name=? LIMIT 1`)
    .bind(UNIQUE_INDEX)
    .first();
  if (!row?.name) throw new Error(`required database index ${UNIQUE_INDEX} is not installed`);
}

async function alreadyImported(db, snapshot) {
  const row = await db.prepare(`SELECT
    COUNT(*) AS row_count,
    COUNT(DISTINCT rank) AS rank_count,
    MIN(rank) AS min_rank,
    MAX(rank) AS max_rank,
    SUM(CASE WHEN json_valid(raw_json) AND json_extract(raw_json,'$.digest')=? THEN 1 ELSE 0 END) AS digest_rows
  FROM sh_channel_rankings
  WHERE ranking_date=? AND ranking_type=?`)
    .bind(snapshot.digest, snapshot.ranking_date, RANKING_TYPE)
    .first();
  return Number(row?.row_count || 0) === snapshot.rows.length
    && Number(row?.rank_count || 0) === snapshot.rows.length
    && Number(row?.min_rank || 0) === 1
    && Number(row?.max_rank || 0) === snapshot.rows.length
    && Number(row?.digest_rows || 0) === snapshot.rows.length;
}

async function cleanupStaleRows(db, snapshot) {
  const placeholders = snapshot.rows.map(() => '?').join(',');
  const hosts = snapshot.rows.map(row => row.channel_name);
  await db.prepare(`DELETE FROM sh_channel_rankings
    WHERE ranking_date=? AND ranking_type=?
      AND (
        channel_name IS NULL OR trim(channel_name)=''
        OR lower(trim(channel_name)) NOT IN (${placeholders})
      )`)
    .bind(snapshot.ranking_date, RANKING_TYPE, ...hosts)
    .run();
}

async function verifyImportedRows(db, snapshot) {
  const row = await db.prepare(`SELECT
    COUNT(*) AS row_count,
    COUNT(DISTINCT lower(trim(channel_name))) AS host_count,
    COUNT(DISTINCT rank) AS rank_count,
    MIN(rank) AS min_rank,
    MAX(rank) AS max_rank,
    SUM(CASE WHEN json_valid(raw_json) AND json_extract(raw_json,'$.digest')=? THEN 1 ELSE 0 END) AS digest_rows
  FROM sh_channel_rankings
  WHERE ranking_date=? AND ranking_type=?`)
    .bind(snapshot.digest, snapshot.ranking_date, RANKING_TYPE)
    .first();
  const counts = {
    rows: Number(row?.row_count || 0),
    hosts: Number(row?.host_count || 0),
    ranks: Number(row?.rank_count || 0),
    minRank: Number(row?.min_rank || 0),
    maxRank: Number(row?.max_rank || 0),
    digestRows: Number(row?.digest_rows || 0),
  };
  if (counts.rows !== snapshot.rows.length
      || counts.hosts !== snapshot.rows.length
      || counts.ranks !== snapshot.rows.length
      || counts.minRank !== 1
      || counts.maxRank !== snapshot.rows.length
      || counts.digestRows !== snapshot.rows.length) {
    throw new Error(`weekly leaderboard verification failed: ${JSON.stringify(counts)}`);
  }
  return counts;
}

export async function syncWeeklyLeaderboard(db, rawPayload, now = Date.now()) {
  const snapshot = validateWeeklyLeaderboardPayload(rawPayload);
  await verifyUniqueIndex(db);
  if (await alreadyImported(db, snapshot)) {
    return { changed: false, ranking_date: snapshot.ranking_date, rows: snapshot.rows.length, digest: snapshot.digest };
  }

  const importedAt = Number.isSafeInteger(now) && now > 0 ? now : Date.now();
  for (let offset = 0; offset < snapshot.rows.length; offset += UPSERT_CHUNK_SIZE) {
    const chunk = snapshot.rows.slice(offset, offset + UPSERT_CHUNK_SIZE);
    await db.batch(chunk.map(row => upsertStatement(db, snapshot, row, importedAt)));
  }
  await cleanupStaleRows(db, snapshot);
  await verifyImportedRows(db, snapshot);
  return { changed: true, ranking_date: snapshot.ranking_date, rows: snapshot.rows.length, digest: snapshot.digest };
}

async function loadPayloadFromFile(path) {
  const { readFile } = await import('node:fs/promises');
  return JSON.parse(await readFile(path, 'utf8'));
}

async function main() {
  const input = process.env.STATIONHEAD_WEEKLY_LEADERBOARD_FILE || process.argv[2];
  if (!input) throw new Error('STATIONHEAD_WEEKLY_LEADERBOARD_FILE or an input file argument is required');
  const workerRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const wranglerScript = resolve(workerRoot, 'node_modules/wrangler/bin/wrangler.js');
  const database = process.env.OTHER_DATABASE_NAME || 'stationhead-other';
  const db = createWranglerRemoteD1({ database, cwd: workerRoot, wranglerScript });
  const result = await syncWeeklyLeaderboard(db, await loadPayloadFromFile(resolve(input)));
  process.stdout.write(`${JSON.stringify(result)}\n`);
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) {
    const { appendFile } = await import('node:fs/promises');
    await appendFile(summary, [
      '## Stationhead weekly leaderboard sync',
      '',
      `- week: \`${result.ranking_date}\``,
      `- rows: \`${result.rows}\``,
      `- digest: \`${result.digest.slice(0, 16)}…\``,
      `- database changed: \`${String(result.changed)}\``,
      '',
    ].join('\n'));
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath && invokedPath === resolve(fileURLToPath(import.meta.url))) {
  main().catch(error => {
    console.error(error instanceof Error ? error.stack || error.message : error);
    process.exitCode = 1;
  });
}
