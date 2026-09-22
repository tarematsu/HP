import { readFileSync, appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createWranglerRemoteD1 } from './remote-d1-adapter.mjs';

export const RANKING_TYPE = '週間リーダーボード';
export const SOURCE_SHEET = 'weekly';
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DEFAULT_ARTIFACT = '../probe-artifact/stationhead-leaderboard-latest.json';
const MAX_ROWS = 100;
const MIN_COMPLETE_ROWS = 10;

function compactText(value, maximum = 120) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, maximum);
}

function normalizeLabel(value) {
  return compactText(value, 80)
    .toLowerCase()
    .replace(/[：:]/g, '')
    .replace(/\s+/g, '')
    .replace(/[()（）]/g, '');
}

function parseMetric(value) {
  const text = compactText(value, 80).toUpperCase().replace(/,/g, '');
  if (!text) return null;
  const match = text.match(/(-?\d+(?:\.\d+)?)\s*([KMB])?/);
  if (!match) return null;
  const scale = match[2] === 'K' ? 1_000
    : match[2] === 'M' ? 1_000_000
      : match[2] === 'B' ? 1_000_000_000
        : 1;
  const number = Number(match[1]) * scale;
  if (!Number.isFinite(number)) return null;
  return Math.round(number);
}

function parseRank(value) {
  const text = compactText(value, 30);
  const match = text.match(/^#?\s*(\d{1,3})(?:\.|位)?$/);
  if (!match) return null;
  const rank = Number(match[1]);
  return Number.isInteger(rank) && rank >= 1 && rank <= 500 ? rank : null;
}

function displayAndCanonicalName(value) {
  const display = compactText(value, 100).replace(/^@/, '');
  if (!display) return null;
  const atHandle = display.match(/@([A-Za-z0-9_.-]{1,80})/);
  const candidate = atHandle?.[1] || display;
  if (!/^[A-Za-z0-9_.-]{1,80}$/.test(candidate)) return null;
  return {
    display,
    canonical: candidate.toLowerCase(),
  };
}

function headerKind(value) {
  const label = normalizeLabel(value);
  if (!label) return null;
  if (label === '#' || /^(rank|ranking|順位)$/.test(label)) return 'rank';
  if (/^(username|user|handle|station|channel|host|name|ユーザー|アカウント)$/.test(label)) return 'name';
  if (/^(streams?|listens?|plays?|再生数?|ストリーム数?)$/.test(label)) return 'streams';
  if (/^(days?|日数)$/.test(label)) return 'days';
  return null;
}

function normalizeCandidateRow(rank, nameValue, streamsValue, daysValue = null) {
  const name = displayAndCanonicalName(nameValue);
  const streams = streamsValue == null ? null : parseMetric(streamsValue);
  const days = daysValue == null ? null : parseMetric(daysValue);
  if (!rank || !name || (streams != null && streams < 0)) return null;
  return {
    rank,
    channel_name: name.canonical,
    channel_alias: name.display,
    streams,
    days: days != null && days >= 0 && days <= 366 ? days : null,
  };
}
function uniqueSortedRows(rows) {
  const byRank = new Map();
  const channels = new Set();
  for (const row of rows) {
    if (!row || byRank.has(row.rank) || channels.has(row.channel_name)) continue;
    byRank.set(row.rank, row);
    channels.add(row.channel_name);
  }
  return [...byRank.values()].sort((a, b) => a.rank - b.rank).slice(0, MAX_ROWS);
}

function parseDirectRanking(snapshot) {
  if (!Array.isArray(snapshot?.ranking)) return [];
  return uniqueSortedRows(snapshot.ranking.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
    const rank = Number(entry.rank);
    const name = entry.username ?? entry.user ?? entry.name ?? entry.channel ?? entry.station ?? entry.handle;
    const streams = entry.streams ?? entry.listens ?? entry.plays ?? entry.total_listens;
    const days = entry.days ?? entry.day_count ?? entry.active_days;
    return normalizeCandidateRow(Number.isInteger(rank) ? rank : null, name, streams, days);
  }));
}

function parseTableRows(snapshot) {
  const rows = Array.isArray(snapshot?.rows)
    ? snapshot.rows.filter((row) => Array.isArray(row)).map((row) => row.map((cell) => compactText(cell, 100)))
    : [];
  if (!rows.length) return { rows: [], parser: null };

  for (let headerIndex = 0; headerIndex < Math.min(rows.length, 6); headerIndex += 1) {
    const mapping = {};
    rows[headerIndex].forEach((cell, index) => {
      const kind = headerKind(cell);
      if (kind && mapping[kind] == null) mapping[kind] = index;
    });
    if (mapping.rank == null || mapping.name == null || mapping.streams == null) continue;
    const parsed = uniqueSortedRows(rows.slice(headerIndex + 1).map((row) => normalizeCandidateRow(
      parseRank(row[mapping.rank]),
      row[mapping.name],
      row[mapping.streams],
      mapping.days == null ? null : row[mapping.days],
    )));
    if (parsed.length) return { rows: parsed, parser: 'table-header' };
  }

  const fallback = uniqueSortedRows(rows.map((row) => {
    if (row.length < 3) return null;
    const rank = parseRank(row[0]);
    if (!rank) return null;
    let nameIndex = -1;
    let nameValue = null;
    for (let index = 1; index < row.length; index += 1) {
      const name = displayAndCanonicalName(row[index]);
      if (name) {
        nameIndex = index;
        nameValue = row[index];
        break;
      }
    }
    if (nameIndex < 0) return null;
    const metrics = [];
    for (let index = nameIndex + 1; index < row.length; index += 1) {
      const metric = parseMetric(row[index]);
      if (metric != null) metrics.push(metric);
    }
    return normalizeCandidateRow(rank, nameValue, metrics[0], metrics[1]);
  }));
  return fallback.length >= 3
    ? { rows: fallback, parser: 'table-positional' }
    : { rows: [], parser: null };
}

function longestConsecutiveSequence(rows) {
  if (!rows.length) return [];
  const sorted = uniqueSortedRows(rows);
  let best = [];
  let current = [];
  for (const row of sorted) {
    if (!current.length || row.rank === current.at(-1).rank + 1) current.push(row);
    else current = [row];
    if (current.length > best.length) best = [...current];
  }
  return best;
}

function parseLines(snapshot) {
  const lines = Array.isArray(snapshot?.lines)
    ? snapshot.lines.map((line) => compactText(line, 120)).filter(Boolean)
    : [];
  if (!lines.length) return [];
  const candidates = [];
  for (let index = 0; index < lines.length; index += 1) {
    const rank = parseRank(lines[index]);
    if (!rank) continue;
    const block = [];
    for (let cursor = index + 1; cursor < Math.min(lines.length, index + 8); cursor += 1) {
      if (parseRank(lines[cursor])) break;
      block.push(lines[cursor]);
    }
    let nameValue = null;
    let nameOffset = -1;
    for (let cursor = 0; cursor < block.length; cursor += 1) {
      if (displayAndCanonicalName(block[cursor]) && headerKind(block[cursor]) == null) {
        nameValue = block[cursor];
        nameOffset = cursor;
        break;
      }
    }
    if (nameOffset < 0) continue;
    const metrics = block.slice(nameOffset + 1).map(parseMetric).filter((value) => value != null);
    const row = normalizeCandidateRow(rank, nameValue, metrics[0], metrics[1]);
    if (row) candidates.push(row);
  }
  const consecutive = longestConsecutiveSequence(candidates);
  return consecutive.length >= 3 ? consecutive : [];
}

export function parseLeaderboardSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return null;

  const direct = parseDirectRanking(snapshot);
  if (direct.length) return { rows: direct, parser: 'direct-ranking' };

  const table = parseTableRows(snapshot);
  if (table.rows.length) return table;

  const lines = parseLines(snapshot);
  if (lines.length) return { rows: lines, parser: 'line-sequence' };
  return null;
}

export function mondayDateInJst(timestamp) {
  if (!Number.isFinite(Number(timestamp))) return null;
  const shifted = new Date(Number(timestamp) + JST_OFFSET_MS);
  if (Number.isNaN(shifted.getTime())) return null;
  shifted.setUTCHours(0, 0, 0, 0);
  const daysSinceMonday = (shifted.getUTCDay() + 6) % 7;
  shifted.setUTCDate(shifted.getUTCDate() - daysSinceMonday);
  return shifted.toISOString().slice(0, 10);
}

function parseRecordBody(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return null;
  try {
    const parsed = JSON.parse(String(record.body ?? ''));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function extractLeaderboardFromArtifact(artifact) {
  if (!artifact || artifact.version !== 1 || !Array.isArray(artifact.records)) {
    throw new Error('invalid stationhead leaderboard artifact');
  }
  if (artifact.available === false || artifact.records.length === 0) {
    return { status: 'skipped', reason: 'r2-payload-unavailable' };
  }

  const candidates = [...artifact.records]
    .map((record) => ({ record, snapshot: parseRecordBody(record) }))
    .filter(({ snapshot }) => snapshot)
    .sort((a, b) => Number(b.record.observed_at || 0) - Number(a.record.observed_at || 0));

  let sawReadySnapshot = false;
  for (const { record, snapshot } of candidates) {
    const path = compactText(snapshot.path || '', 320);
    const ready = (
      snapshot.schema === 2
      && snapshot.signed_in === true
      && snapshot.leaderboard_ready === true
      && /^\/leaderboard\/?$/i.test(path)
    );
    if (!ready) continue;
    sawReadySnapshot = true;
    const parsed = parseLeaderboardSnapshot(snapshot);
    // The native collector declares readiness only after ten ordered ranks.
    // Reject partial captures before the weekly DELETE/INSERT replacement.
    if (!parsed || parsed.rows.length < MIN_COMPLETE_ROWS
      || parsed.rows.some((row, index) => row.rank !== index + 1)) continue;
    const observedAt = Number(record.observed_at) || Number(snapshot.captured_at);
    const rankingDate = mondayDateInJst(observedAt);
    if (!rankingDate) throw new Error('leaderboard snapshot has no valid observed_at timestamp');
    return {
      status: 'ready',
      digest: compactText(artifact.digest, 128),
      ranking_date: rankingDate,
      observed_at: observedAt,
      captured_at: Number(snapshot.captured_at) || observedAt,
      source: compactText(record.source, 32),
      parser: parsed.parser,
      rows: parsed.rows,
    };
  }

  if (sawReadySnapshot) {
    throw new Error('ready Stationhead leaderboard snapshot could not be parsed into ranking rows');
  }
  return { status: 'skipped', reason: 'no-authenticated-ready-snapshot' };
}

function parsedRawJson(value) {
  if (typeof value !== 'string' || !value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function sameDigestRows(existingRows, digest, expectedCount) {
  if (!digest || existingRows.length !== expectedCount) return false;
  return existingRows.every((row) => parsedRawJson(row.raw_json)?.source_digest === digest);
}

export async function importLeaderboardArtifact(artifact, db, now = Date.now()) {
  const extracted = extractLeaderboardFromArtifact(artifact);
  if (extracted.status !== 'ready') return extracted;
  const existing = await db.prepare(`SELECT raw_json
FROM sh_channel_rankings
WHERE ranking_date=? AND ranking_type=?
ORDER BY rank ASC`).bind(extracted.ranking_date, RANKING_TYPE).all();
  const existingRows = existing.results || [];
  if (sameDigestRows(existingRows, extracted.digest, extracted.rows.length)) {
    return {
      status: 'unchanged',
      ranking_date: extracted.ranking_date,
      row_count: extracted.rows.length,
      digest: extracted.digest,
      parser: extracted.parser,
    };
  }

  const statements = [
    db.prepare('DELETE FROM sh_channel_rankings WHERE ranking_date=? AND ranking_type=?')
      .bind(extracted.ranking_date, RANKING_TYPE),
  ];

  for (const row of extracted.rows) {
    const rawJson = JSON.stringify({
      source: 'stationhead_r2',
      source_digest: extracted.digest || null,
      parser: extracted.parser,
      captured_at: extracted.captured_at,
      observed_at: extracted.observed_at,
      weekly_streams: row.streams,
      active_days: row.days,
      row_count: extracted.rows.length,
    });
    statements.push(db.prepare(`INSERT INTO sh_channel_rankings(
      ranking_date,observed_at,ranking_type,rank,channel_name,channel_alias,
      listener_count,member_count,total_listens,source_sheet,source_row,
      quality_score,quality_flags,raw_json,imported_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
      extracted.ranking_date,
      extracted.observed_at,
      RANKING_TYPE,
      row.rank,
      row.channel_name,
      row.channel_alias,
      null,
      null,
      row.streams,
      SOURCE_SHEET,
      row.rank,
      1,
      JSON.stringify(['stationhead_r2', 'weekly_leaderboard', extracted.parser]),
      rawJson,
      now,
    ));
  }
  await db.batch(statements);
  return {
    status: 'imported',
    ranking_date: extracted.ranking_date,
    row_count: extracted.rows.length,
    digest: extracted.digest,
    parser: extracted.parser,
  };
}

function appendSummary(result) {
  const path = process.env.GITHUB_STEP_SUMMARY;
  if (!path) return;
  appendFileSync(path, [
    '## Stationhead weekly leaderboard → Other.db',
    '',
    `- status: \`${result.status}\``,
    `- ranking_date: \`${result.ranking_date ?? ''}\``,
    `- rows: \`${result.row_count ?? 0}\``,
    `- parser: \`${result.parser ?? ''}\``,
    `- digest: \`${result.digest ? String(result.digest).slice(0, 16) : ''}\``,
    `- reason: \`${result.reason ?? ''}\``,
    '',
  ].join('\n'));
}

export async function main() {
  const artifactPath = resolve(process.cwd(), process.argv[2] || process.env.STATIONHEAD_LEADERBOARD_ARTIFACT || DEFAULT_ARTIFACT);
  const artifact = JSON.parse(readFileSync(artifactPath, 'utf8'));
  const workerRoot = resolve(import.meta.dirname, '..');
  const wranglerScript = resolve(workerRoot, 'node_modules/wrangler/bin/wrangler.js');
  const db = createWranglerRemoteD1({
    database: process.env.OTHER_DATABASE_NAME || 'stationhead-other',
    cwd: workerRoot,
    wranglerScript,
  });
  const result = await importLeaderboardArtifact(artifact, db);
  appendSummary(result);
  console.log(JSON.stringify({
    status: result.status,
    ranking_date: result.ranking_date ?? null,
    row_count: result.row_count ?? 0,
    parser: result.parser ?? null,
    digest: result.digest ? String(result.digest).slice(0, 16) : null,
    reason: result.reason ?? null,
  }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
}
