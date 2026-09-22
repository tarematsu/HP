import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const RANKING_TYPE = '週間リーダーボード';
export const SOURCE_SHEET = 'stationhead_r2';
const DAY_MS = 86_400_000;

function text(value, maximum = 160) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, maximum);
}

function normalizedName(value) {
  return text(value, 120).toLocaleLowerCase('en-US');
}

function validWeek(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).getUTCDay() === 1;
}

export function weeklyImportWindow(week) {
  if (!validWeek(week)) throw new Error(`week must be a Monday in YYYY-MM-DD format: ${week}`);
  const mondayUtc = Date.parse(`${week}T00:00:00Z`);
  return {
    start: mondayUtc + 9 * 60 * 60 * 1000, // Monday 18:00 JST.
    end: mondayUtc + 39 * 60 * 60 * 1000, // Wednesday 00:00 JST (Tuesday end).
  };
}

function parseRank(value) {
  const match = text(value, 32).match(/^#?\s*(\d{1,3})\s*(?:st|nd|rd|th|位|[.)])?$/i);
  if (!match) return null;
  const rank = Number(match[1]);
  return Number.isInteger(rank) && rank >= 1 && rank <= 500 ? rank : null;
}

function parseMetric(value) {
  const raw = text(value, 48).replaceAll(',', '').replace(/\s+/g, '');
  const match = raw.match(/^([0-9]+(?:\.[0-9]+)?)([kmb])?$/i);
  if (!match) return null;
  const multipliers = { k: 1_000, m: 1_000_000, b: 1_000_000_000 };
  const number = Number(match[1]) * (multipliers[String(match[2] || '').toLowerCase()] || 1);
  return Number.isFinite(number) && number >= 0 ? Math.round(number) : null;
}

function headerRole(value) {
  const label = text(value, 80).toLowerCase();
  if (!label) return null;
  if (label === '#' || /\brank(?:ing)?\b|順位/.test(label)) return 'rank';
  if (/\b(?:station|channel|host|creator)(?:\s+name)?\b|^name$|ステーション|チャンネル|ホスト/.test(label)) return 'name';
  if (/\blisteners?\b|同接|リスナー/.test(label)) return 'listeners';
  if (/\bmembers?\b|メンバー/.test(label)) return 'members';
  if (/\b(?:total\s*)?listens?\b|\bstreams?\b|\bplays?\b|再生/.test(label)) return 'listens';
  return null;
}

function headerMap(rows) {
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = Array.isArray(rows[rowIndex]) ? rows[rowIndex] : [];
    const roles = row.map(headerRole);
    const rank = roles.indexOf('rank');
    const name = roles.indexOf('name');
    if (rank >= 0 && name >= 0) {
      return {
        rowIndex,
        rank,
        name,
        listeners: roles.indexOf('listeners'),
        members: roles.indexOf('members'),
        listens: roles.indexOf('listens'),
      };
    }
  }
  return null;
}

function plausibleName(value) {
  const candidate = text(value, 120);
  if (!candidate || parseRank(candidate) != null || parseMetric(candidate) != null) return false;
  if (headerRole(candidate)) return false;
  return /[A-Za-z0-9_@\-\u3040-\u30ff\u3400-\u9fff]/.test(candidate);
}

function structuredRows(snapshot) {
  if (!Array.isArray(snapshot?.ranking)) return [];
  return snapshot.ranking.map((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const rank = parseRank(raw.rank);
    const name = text(raw.name ?? raw.host ?? raw.channel ?? raw.channel_name, 120);
    if (rank == null || !plausibleName(name)) return null;
    return {
      rank,
      name,
      listenerCount: parseMetric(raw.listener_count ?? raw.listeners),
      memberCount: parseMetric(raw.member_count ?? raw.members),
      totalListens: parseMetric(raw.total_listens ?? raw.listens ?? raw.streams ?? raw.plays),
      sourceRow: index + 1,
      quality: 1,
      flags: ['stationhead_r2', 'structured'],
      raw: {
        rank,
        name,
        listener_count: raw.listener_count ?? raw.listeners ?? null,
        member_count: raw.member_count ?? raw.members ?? null,
        total_listens: raw.total_listens ?? raw.listens ?? raw.streams ?? raw.plays ?? null,
      },
    };
  }).filter(Boolean);
}

function tableRows(snapshot) {
  const rows = Array.isArray(snapshot?.rows) ? snapshot.rows.filter(Array.isArray) : [];
  const mapping = headerMap(rows);
  const output = [];
  if (mapping) {
    for (let index = mapping.rowIndex + 1; index < rows.length; index += 1) {
      const row = rows[index];
      const rank = parseRank(row[mapping.rank]);
      const name = text(row[mapping.name], 120);
      if (rank == null || !plausibleName(name)) continue;
      output.push({
        rank,
        name,
        listenerCount: mapping.listeners >= 0 ? parseMetric(row[mapping.listeners]) : null,
        memberCount: mapping.members >= 0 ? parseMetric(row[mapping.members]) : null,
        totalListens: mapping.listens >= 0 ? parseMetric(row[mapping.listens]) : null,
        sourceRow: index + 1,
        quality: 1,
        flags: ['stationhead_r2', 'dom_snapshot', 'header_mapped'],
        raw: row.slice(0, 8).map((cell) => text(cell, 120)),
      });
    }
    return output;
  }

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const rankIndex = row.findIndex((cell) => parseRank(cell) != null);
    if (rankIndex < 0) continue;
    const rank = parseRank(row[rankIndex]);
    const name = row.slice(rankIndex + 1).find(plausibleName);
    if (rank == null || !name) continue;
    output.push({
      rank,
      name: text(name, 120),
      listenerCount: null,
      memberCount: null,
      totalListens: null,
      sourceRow: index + 1,
      quality: 0.9,
      flags: ['stationhead_r2', 'dom_snapshot', 'heuristic_row'],
      raw: row.slice(0, 8).map((cell) => text(cell, 120)),
    });
  }
  return output;
}

function lineRows(snapshot) {
  const lines = Array.isArray(snapshot?.lines) ? snapshot.lines.map((line) => text(line, 120)).filter(Boolean) : [];
  const output = [];
  for (let index = 0; index < lines.length; index += 1) {
    const inline = lines[index].match(/^#?\s*(\d{1,3})(?:st|nd|rd|th|位)?\s+[.:-]?\s*(.+)$/i);
    if (inline && plausibleName(inline[2])) {
      const rank = parseRank(inline[1]);
      if (rank != null) output.push({
        rank,
        name: text(inline[2], 120),
        listenerCount: null,
        memberCount: null,
        totalListens: null,
        sourceRow: index + 1,
        quality: 0.8,
        flags: ['stationhead_r2', 'dom_snapshot', 'heuristic_line'],
        raw: lines[index],
      });
      continue;
    }
    const rank = parseRank(lines[index]);
    const next = lines[index + 1];
    if (rank != null && plausibleName(next)) {
      output.push({
        rank,
        name: text(next, 120),
        listenerCount: null,
        memberCount: null,
        totalListens: null,
        sourceRow: index + 1,
        quality: 0.8,
        flags: ['stationhead_r2', 'dom_snapshot', 'heuristic_line_pair'],
        raw: [lines[index], next],
      });
      index += 1;
    }
  }
  return output;
}

function dedupeRows(rows) {
  const byName = new Map();
  for (const row of rows) {
    const key = normalizedName(row.name);
    if (!key) continue;
    const previous = byName.get(key);
    if (!previous || row.rank < previous.rank || (row.rank === previous.rank && row.quality > previous.quality)) {
      byName.set(key, row);
    }
  }
  return [...byName.values()].sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name, 'ja'));
}

export function normalizeWeeklyLeaderboardArtifact(artifact, week) {
  const { start, end } = weeklyImportWindow(week);
  if (!artifact || artifact.version !== 1 || !Array.isArray(artifact.records)) {
    throw new Error('invalid Stationhead leaderboard R2 payload');
  }

  const snapshots = [];
  for (const record of artifact.records) {
    const observedAt = Number(record?.observed_at);
    if (!Number.isSafeInteger(observedAt) || observedAt < start || observedAt >= end || Number(record?.status) !== 200) continue;
    let snapshot;
    try { snapshot = JSON.parse(String(record?.body ?? '')); } catch { continue; }
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) continue;
    if (snapshot.signed_in === false || snapshot.leaderboard_ready === false) continue;
    if (snapshot.path && !/^\/leaderboard\/?$/i.test(String(snapshot.path))) continue;
    const structured = structuredRows(snapshot);
    const table = structured.length ? [] : tableRows(snapshot);
    const lines = structured.length || table.length ? [] : lineRows(snapshot);
    const rows = dedupeRows(structured.length ? structured : table.length ? table : lines);
    if (rows.length) snapshots.push({ observedAt, snapshot, rows });
  }

  snapshots.sort((a, b) => a.observedAt - b.observedAt);
  const selected = snapshots.at(-1);
  if (!selected) throw new Error(`no usable leaderboard snapshot in ${week} Monday-night/Tuesday window`);

  return {
    week,
    observedAt: selected.observedAt,
    snapshotSchema: Number.isInteger(selected.snapshot.schema) ? selected.snapshot.schema : null,
    rows: selected.rows,
  };
}

function sqlString(value) {
  if (value == null) return 'NULL';
  return `'${String(value).replaceAll("'", "''")}'`;
}

function sqlNumber(value) {
  return Number.isFinite(Number(value)) ? String(Number(value)) : 'NULL';
}

export function renderWeeklyLeaderboardSql(normalized, importedAt = Date.now()) {
  if (!normalized?.rows?.length) throw new Error('weekly leaderboard import requires at least one row');
  const columns = [
    'ranking_date', 'observed_at', 'ranking_type', 'rank', 'channel_name', 'channel_alias',
    'listener_count', 'member_count', 'total_listens', 'source_sheet', 'source_row',
    'quality_score', 'quality_flags', 'raw_json', 'imported_at',
  ];
  const statements = normalized.rows.map((row) => {
    const rawJson = JSON.stringify({
      source: SOURCE_SHEET,
      snapshot_schema: normalized.snapshotSchema,
      row: row.raw,
    }).slice(0, 4_000);
    const values = [
      sqlString(normalized.week),
      sqlNumber(normalized.observedAt),
      sqlString(RANKING_TYPE),
      sqlNumber(row.rank),
      sqlString(row.name),
      'NULL',
      sqlNumber(row.listenerCount),
      sqlNumber(row.memberCount),
      sqlNumber(row.totalListens),
      sqlString(SOURCE_SHEET),
      sqlNumber(row.sourceRow),
      sqlNumber(row.quality),
      sqlString(JSON.stringify(row.flags)),
      sqlString(rawJson),
      sqlNumber(importedAt),
    ];
    return `INSERT OR REPLACE INTO sh_channel_rankings(${columns.join(',')}) VALUES(${values.join(',')});`;
  });
  const names = normalized.rows.map((row) => sqlString(normalizedName(row.name))).join(',');
  statements.push(
    `DELETE FROM sh_channel_rankings WHERE ranking_date=${sqlString(normalized.week)} AND ranking_type=${sqlString(RANKING_TYPE)} AND source_sheet=${sqlString(SOURCE_SHEET)} AND lower(trim(channel_name)) NOT IN (${names});`,
  );
  return `${statements.join('\n')}\n`;
}

function args(argv) {
  const output = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) continue;
    output[key.slice(2)] = argv[index + 1];
    index += 1;
  }
  return output;
}

function main() {
  const options = args(process.argv.slice(2));
  if (!options.input || !options.week || !options.sql || !options.meta) {
    throw new Error('usage: import-stationhead-leaderboard-weekly.mjs --input FILE --week YYYY-MM-DD --sql FILE --meta FILE');
  }
  const artifact = JSON.parse(readFileSync(options.input, 'utf8'));
  const normalized = normalizeWeeklyLeaderboardArtifact(artifact, options.week);
  const importedAt = Date.now();
  writeFileSync(options.sql, renderWeeklyLeaderboardSql(normalized, importedAt));
  writeFileSync(options.meta, `${JSON.stringify({
    week: normalized.week,
    observed_at: normalized.observedAt,
    row_count: normalized.rows.length,
    ranking_type: RANKING_TYPE,
    source_sheet: SOURCE_SHEET,
    imported_at: importedAt,
  }, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ week: normalized.week, observed_at: normalized.observedAt, row_count: normalized.rows.length })}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
