import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createWranglerRemoteD1 } from './remote-d1-adapter.mjs';

const DAY_MS = 86_400_000;
const MODEL_VERSION = 1;

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
    const artistName = String(row?.artist_name || '').trim();
    if (!artistName) continue;
    metadata.set(hostKey(row.host_name), {
      artist_name: artistName,
      fandom_type: row.relation_type === 'official' ? 'official' : 'fandom',
    });
  }
  return (rows || []).map((row) => {
    const fandom = metadata.get(hostKey(row.host_name));
    const decorated = { ...row };
    if (fandom) {
      decorated.artist_name = fandom.artist_name;
      decorated.fandom_type = fandom.fandom_type;
      decorated.fandom_label = fandomLabel(fandom.artist_name, fandom.fandom_type);
    } else {
      decorated.artist_name = null;
      decorated.fandom_type = null;
      decorated.fandom_label = null;
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
  for (const row of actualRows) {
    const key = hostKey(row.host_name);
    const week = String(row.ranking_date || '');
    if (!validDate(week) || !key) continue;
    const previous = firstSeen.get(key);
    if (!previous || week < previous) firstSeen.set(key, week);
    actualByWeekHost.set(`${week}\u0000${key}`, row);
  }

  const completed = [];
  for (const host of hosts) {
    const key = hostKey(host);
    const first = firstSeen.get(key);
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
        artist_name: actualRows.find((row) => hostKey(row.host_name) === key)?.artist_name || null,
        fandom_type: actualRows.find((row) => hostKey(row.host_name) === key)?.fandom_type || null,
        fandom_label: actualRows.find((row) => hostKey(row.host_name) === key)?.fandom_label || null,
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

async function ensureReadModelTable(db) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS sh_weekly_ranking_read_model (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    source_max_ranking_date TEXT,
    payload_json TEXT NOT NULL,
    refreshed_at INTEGER NOT NULL
  )`).run();
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
    db.prepare('SELECT source_max_ranking_date,refreshed_at FROM sh_weekly_ranking_read_model WHERE id=1').first(),
  ]);

  const model = buildWeeklyRankingReadModel(
    rankingResult.results || [],
    fandomResult.results || [],
    weeklyResult.results || [],
    now,
  );
  if (existing?.source_max_ranking_date && existing.source_max_ranking_date === model.source_max_ranking_date) {
    return {
      status: 'unchanged',
      source_max_ranking_date: model.source_max_ranking_date,
      refreshed_at: Number(existing.refreshed_at) || null,
      row_count: model.actual_rows.length,
    };
  }

  await db.prepare(`INSERT INTO sh_weekly_ranking_read_model(id,source_max_ranking_date,payload_json,refreshed_at)
    VALUES(1,?,?,?)
    ON CONFLICT(id) DO UPDATE SET
      source_max_ranking_date=excluded.source_max_ranking_date,
      payload_json=excluded.payload_json,
      refreshed_at=excluded.refreshed_at`)
    .bind(model.source_max_ranking_date, JSON.stringify(model), now)
    .run();

  return {
    status: 'materialized',
    source_max_ranking_date: model.source_max_ranking_date,
    refreshed_at: now,
    row_count: model.actual_rows.length,
    completed_row_count: model.completed_rows.length,
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
