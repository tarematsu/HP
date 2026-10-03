export const STATIONHEAD_LEADERBOARD_STATUS_KEY = 'diagnostics/stationhead-leaderboard/status.json';
export const STATIONHEAD_LEADERBOARD_LATEST_KEY = 'diagnostics/stationhead-leaderboard/latest.json';
export const RANKING_TYPE = '週間リーダーボード';
export const SOURCE_SHEET = 'weekly';
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const MAX_ROWS = 100;

function compactText(value, maximum = 120) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, maximum);
}

function normalizeLabel(value) {
  return compactText(value, 80).toLowerCase().replace(/[：:]/g, '').replace(/\s+/g, '').replace(/[()（）]/g, '');
}

function parseMetric(value) {
  const text = compactText(value, 80).toUpperCase().replace(/,/g, '');
  const match = text.match(/(-?\d+(?:\.\d+)?)\s*([KMB])?/);
  if (!match) return null;
  const scale = match[2] === 'K' ? 1_000 : match[2] === 'M' ? 1_000_000 : match[2] === 'B' ? 1_000_000_000 : 1;
  const parsed = Number(match[1]) * scale;
  return Number.isFinite(parsed) ? Math.round(parsed) : null;
}

function parseRank(value) {
  const match = compactText(value, 30).match(/^#?\s*(\d{1,3})(?:\.|位)?$/);
  if (!match) return null;
  const rank = Number(match[1]);
  return Number.isInteger(rank) && rank >= 1 && rank <= 500 ? rank : null;
}

function displayAndCanonicalName(value) {
  const display = compactText(value, 100).replace(/^@/, '');
  if (!display) return null;
  const at = display.match(/@([A-Za-z0-9_.-]{1,80})/);
  const candidate = at?.[1] || display;
  return /^[A-Za-z0-9_.-]{1,80}$/.test(candidate) ? { display, canonical: candidate.toLowerCase() } : null;
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

function normalizeRow(rank, nameValue, streamsValue, daysValue = null) {
  const name = displayAndCanonicalName(nameValue);
  const streams = streamsValue == null ? null : parseMetric(streamsValue);
  const days = daysValue == null ? null : parseMetric(daysValue);
  if (!rank || !name || (streams != null && streams < 0)) return null;
  return { rank, channel_name: name.canonical, channel_alias: name.display, streams, days: days != null && days >= 0 && days <= 366 ? days : null };
}

function uniqueRows(rows) {
  const ranks = new Set();
  const channels = new Set();
  return rows.filter((row) => {
    if (!row || ranks.has(row.rank) || channels.has(row.channel_name)) return false;
    ranks.add(row.rank);
    channels.add(row.channel_name);
    return true;
  }).sort((a, b) => a.rank - b.rank).slice(0, MAX_ROWS);
}

function parseDirect(snapshot) {
  if (!Array.isArray(snapshot?.ranking)) return [];
  return uniqueRows(snapshot.ranking.map((entry) => {
    const rank = Number(entry?.rank);
    return normalizeRow(
      Number.isInteger(rank) ? rank : null,
      entry?.username ?? entry?.user ?? entry?.name ?? entry?.channel ?? entry?.station ?? entry?.handle,
      entry?.streams ?? entry?.listens ?? entry?.plays ?? entry?.total_listens,
      entry?.days ?? entry?.day_count ?? entry?.active_days,
    );
  }));
}

function parseTable(snapshot) {
  const rows = Array.isArray(snapshot?.rows) ? snapshot.rows.filter(Array.isArray).map((row) => row.map((cell) => compactText(cell, 100))) : [];
  for (let header = 0; header < Math.min(rows.length, 6); header += 1) {
    const mapping = {};
    rows[header].forEach((cell, index) => {
      const kind = headerKind(cell);
      if (kind && mapping[kind] == null) mapping[kind] = index;
    });
    if (mapping.rank == null || mapping.name == null || mapping.streams == null) continue;
    const parsed = uniqueRows(rows.slice(header + 1).map((row) => normalizeRow(
      parseRank(row[mapping.rank]), row[mapping.name], row[mapping.streams], mapping.days == null ? null : row[mapping.days],
    )));
    if (parsed.length) return { rows: parsed, parser: 'table-header' };
  }
  return { rows: [], parser: null };
}

function parseLines(snapshot) {
  const lines = Array.isArray(snapshot?.lines) ? snapshot.lines.map((line) => compactText(line, 120)).filter(Boolean) : [];
  const candidates = [];
  for (let index = 0; index < lines.length; index += 1) {
    const rank = parseRank(lines[index]);
    if (!rank) continue;
    const block = [];
    for (let cursor = index + 1; cursor < Math.min(lines.length, index + 8); cursor += 1) {
      if (parseRank(lines[cursor])) break;
      block.push(lines[cursor]);
    }
    const nameIndex = block.findIndex((value) => displayAndCanonicalName(value) && headerKind(value) == null);
    if (nameIndex < 0) continue;
    const metrics = block.slice(nameIndex + 1).map(parseMetric).filter((value) => value != null);
    candidates.push(normalizeRow(rank, block[nameIndex], metrics[0], metrics[1]));
  }
  const sorted = uniqueRows(candidates);
  let best = [];
  let current = [];
  for (const row of sorted) {
    if (!current.length || row.rank === current.at(-1).rank + 1) current.push(row);
    else current = [row];
    if (current.length > best.length) best = [...current];
  }
  return best.length >= 3 ? best : [];
}

export function parseLeaderboardSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return null;
  const direct = parseDirect(snapshot);
  if (direct.length) return { rows: direct, parser: 'direct-ranking' };
  const table = parseTable(snapshot);
  if (table.rows.length) return table;
  const lines = parseLines(snapshot);
  return lines.length ? { rows: lines, parser: 'line-sequence' } : null;
}

function parseRecordBody(record) {
  try {
    const parsed = JSON.parse(String(record?.body ?? ''));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function mondayDateInJst(timestamp) {
  if (!Number.isFinite(Number(timestamp))) return null;
  const shifted = new Date(Number(timestamp) + JST_OFFSET_MS);
  shifted.setUTCHours(0, 0, 0, 0);
  shifted.setUTCDate(shifted.getUTCDate() - ((shifted.getUTCDay() + 6) % 7));
  return shifted.toISOString().slice(0, 10);
}

export function extractLeaderboardFromArtifact(artifact) {
  if (!artifact || artifact.version !== 1 || !Array.isArray(artifact.records)) throw new Error('invalid stationhead leaderboard artifact');
  if (artifact.available === false || artifact.records.length === 0) return { status: 'skipped', reason: 'r2-payload-unavailable' };
  const candidates = [...artifact.records]
    .map((record) => ({ record, snapshot: parseRecordBody(record) }))
    .filter(({ snapshot }) => snapshot)
    .sort((a, b) => Number(b.record.observed_at || 0) - Number(a.record.observed_at || 0));
  let sawReady = false;
  for (const { record, snapshot } of candidates) {
    const path = compactText(snapshot.path || '', 320);
    const ready = Array.isArray(snapshot.ranking) || (snapshot.schema === 2 && snapshot.signed_in === true && snapshot.leaderboard_ready === true && /^\/leaderboard\/?$/i.test(path));
    if (!ready) continue;
    sawReady = true;
    const parsed = parseLeaderboardSnapshot(snapshot);
    if (!parsed?.rows?.length) continue;
    const observedAt = Number(record.observed_at) || Number(snapshot.captured_at);
    const rankingDate = mondayDateInJst(observedAt);
    if (!rankingDate) throw new Error('leaderboard snapshot has no valid observed_at timestamp');
    return {
      status: 'ready',
      digest: compactText(artifact.digest, 128),
      ranking_date: rankingDate,
      observed_at: observedAt,
      captured_at: Number(snapshot.captured_at) || observedAt,
      parser: parsed.parser,
      rows: parsed.rows,
    };
  }
  if (sawReady) throw new Error('ready Stationhead leaderboard snapshot could not be parsed into ranking rows');
  return { status: 'skipped', reason: 'no-authenticated-ready-snapshot' };
}

function rawDigest(value) {
  try { return JSON.parse(String(value || '{}'))?.source_digest || null; } catch { return null; }
}

function completeTop100(rows) {
  return Array.isArray(rows) && rows.length === MAX_ROWS && rows.every((row, index) => row?.rank === index + 1);
}

export async function importLeaderboardArtifact(artifact, db, now = Date.now()) {
  const extracted = extractLeaderboardFromArtifact(artifact);
  if (extracted.status !== 'ready') return extracted;
  if (!completeTop100(extracted.rows)) return { status: 'incomplete', reason: 'expected-complete-top-100', ranking_date: extracted.ranking_date, row_count: extracted.rows.length, digest: extracted.digest, parser: extracted.parser };
  const existing = await db.prepare('SELECT raw_json FROM sh_channel_rankings WHERE ranking_date=? AND ranking_type=? ORDER BY rank ASC')
    .bind(extracted.ranking_date, RANKING_TYPE).all();
  const existingRows = existing.results || [];
  if (extracted.digest && existingRows.length === extracted.rows.length && existingRows.every((row) => rawDigest(row.raw_json) === extracted.digest)) {
    return { status: 'unchanged', ranking_date: extracted.ranking_date, row_count: extracted.rows.length, digest: extracted.digest, parser: extracted.parser };
  }
  const statements = [db.prepare('DELETE FROM sh_channel_rankings WHERE ranking_date=? AND ranking_type=?').bind(extracted.ranking_date, RANKING_TYPE)];
  for (const row of extracted.rows) {
    statements.push(db.prepare(`INSERT INTO sh_channel_rankings(ranking_date,observed_at,ranking_type,rank,channel_name,channel_alias,listener_count,member_count,total_listens,source_sheet,source_row,quality_score,quality_flags,raw_json,imported_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
      extracted.ranking_date, extracted.observed_at, RANKING_TYPE, row.rank, row.channel_name, row.channel_alias,
      null, null, row.streams, SOURCE_SHEET, row.rank, 1,
      JSON.stringify(['stationhead_r2', 'weekly_leaderboard', extracted.parser]),
      JSON.stringify({ source: 'stationhead_r2', source_digest: extracted.digest || null, parser: extracted.parser, captured_at: extracted.captured_at, observed_at: extracted.observed_at, weekly_streams: row.streams, active_days: row.days, row_count: extracted.rows.length }),
      now,
    ));
  }
  await db.batch(statements);
  return { status: 'imported', ranking_date: extracted.ranking_date, row_count: extracted.rows.length, digest: extracted.digest, parser: extracted.parser };
}

async function readJson(r2, key) {
  const object = await r2.get(key);
  if (!object) return null;
  return typeof object.json === 'function' ? object.json() : JSON.parse(await object.text());
}

export async function importStationheadLeaderboardFromR2(env, now = Date.now()) {
  if (!env?.PAGES_RESPONSE_R2?.get) throw new Error('PAGES_RESPONSE_R2 binding is required');
  if (!env?.OTHER_DB?.prepare) throw new Error('OTHER_DB binding is required');
  const artifact = await readJson(env.PAGES_RESPONSE_R2, STATIONHEAD_LEADERBOARD_LATEST_KEY);
  if (!artifact) return { status: 'skipped', reason: 'r2-payload-unavailable' };
  return importLeaderboardArtifact(artifact, env.OTHER_DB, now);
}
