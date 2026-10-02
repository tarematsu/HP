import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export const NETEASE_JAPAN_CHART_ID = '60131';
export const NETEASE_JAPAN_CHART_NAME = '日本Oricon榜';
export const DEFAULT_FROM_DATE = '2015-01-01';

export const TARGETS = Object.freeze([
  Object.freeze({
    canonical_artist: 'sakurazaka46',
    aliases: Object.freeze(['櫻坂46', '樱坂46', 'Sakurazaka46', '欅坂46', 'Keyakizaka46']),
  }),
  Object.freeze({
    canonical_artist: 'nogizaka46',
    aliases: Object.freeze(['乃木坂46', 'Nogizaka46']),
  }),
  Object.freeze({
    canonical_artist: 'hinatazaka46',
    aliases: Object.freeze(['日向坂46', 'Hinatazaka46', 'けやき坂46', 'けやき坂４６', 'Hiragana Keyakizaka46']),
  }),
]);

const CURRENT_ENDPOINTS = Object.freeze([
  'https://music.163.com/api/playlist/detail?id=60131',
  'https://music.163.com/api/v3/playlist/detail?id=60131',
  'https://music.163.com/api/v6/playlist/detail?id=60131',
]);

const ARCHIVE_ENDPOINTS = Object.freeze([
  'http://music.163.com/api/playlist/detail?id=60131',
  'https://music.163.com/api/playlist/detail?id=60131',
  'http://music.163.com/api/v3/playlist/detail?id=60131',
  'https://music.163.com/api/v3/playlist/detail?id=60131',
  'http://music.163.com/discover/toplist?id=60131',
  'https://music.163.com/discover/toplist?id=60131',
]);

const HEADERS = Object.freeze({
  accept: 'application/json,text/html;q=0.9,text/plain;q=0.8,*/*;q=0.5',
  referer: 'https://music.163.com/',
  'user-agent': 'Mozilla/5.0 compatible; skrzk-pages-history-investigator/1.0',
});

function compact(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[\s・･·._\-–—'"`’“”()（）\[\]【】]/g, '');
}

export function targetForArtistNames(names = []) {
  const normalized = names.map(compact).filter(Boolean);
  for (const target of TARGETS) {
    const aliases = target.aliases.map(compact);
    if (normalized.some((name) => aliases.some((alias) => name === alias || name.includes(alias) || alias.includes(name)))) {
      return target.canonical_artist;
    }
  }
  return null;
}

function artistNames(track) {
  const list = track?.artists || track?.ar || track?.song?.artists || track?.song?.ar || [];
  const names = Array.isArray(list) ? list.map((artist) => artist?.name).filter(Boolean) : [];
  if (track?.artist) names.push(track.artist);
  if (track?.artistName) names.push(track.artistName);
  return names;
}

function trackTitle(track) {
  return track?.name || track?.title || track?.song?.name || null;
}

function trackId(track) {
  const id = track?.id ?? track?.song?.id ?? track?.trackId;
  return id == null ? null : String(id);
}

function playlistObject(payload) {
  return payload?.playlist || payload?.result || payload?.data?.playlist || payload?.data || payload || {};
}

export function parseNeteaseJapanJson(payload) {
  const playlist = playlistObject(payload);
  const list = playlist?.tracks || playlist?.songs || payload?.tracks || payload?.songs || [];
  const tracks = Array.isArray(list) ? list : [];
  const entries = tracks.map((track, index) => ({
    position: index + 1,
    track_id: trackId(track),
    title: trackTitle(track),
    artists: artistNames(track),
    canonical_artist: targetForArtistNames(artistNames(track)),
  }));
  return {
    chart_id: String(playlist?.id ?? payload?.id ?? NETEASE_JAPAN_CHART_ID),
    name: playlist?.name || payload?.name || null,
    update_time: Number(playlist?.updateTime ?? playlist?.trackUpdateTime ?? payload?.updateTime) || null,
    track_count: Number(playlist?.trackCount ?? tracks.length) || tracks.length,
    entries,
    matches: entries.filter((entry) => entry.canonical_artist),
  };
}

function decodeHtmlEntities(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, value) => String.fromCodePoint(Number(value)));
}

function stripTags(value) {
  return decodeHtmlEntities(String(value || '').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseNeteaseJapanHtml(html) {
  const source = String(html || '');
  const rows = source.match(/<tr\b[\s\S]*?<\/tr>/gi) || [];
  const matches = [];

  for (const [rowIndex, row] of rows.entries()) {
    const text = stripTags(row);
    if (!text) continue;
    for (const target of TARGETS) {
      const alias = target.aliases.find((item) => compact(text).includes(compact(item)));
      if (!alias) continue;
      const songLink = row.match(/(?:song\?id=|data-res-id=["']?)(\d+)/i);
      const titleMatch = row.match(/<a[^>]+(?:href=["'][^"']*song\?id=\d+[^"']*["']|data-res-id=["']?\d+)[^>]*>([\s\S]*?)<\/a>/i);
      matches.push({
        position: rowIndex + 1,
        track_id: songLink?.[1] || null,
        title: titleMatch ? stripTags(titleMatch[1]) || null : null,
        artists: [alias],
        canonical_artist: target.canonical_artist,
        evidence_text: text.slice(0, 500),
      });
    }
  }

  if (!matches.length) {
    const text = stripTags(source);
    for (const target of TARGETS) {
      const alias = target.aliases.find((item) => compact(text).includes(compact(item)));
      if (!alias) continue;
      const index = compact(text).indexOf(compact(alias));
      const rawIndex = Math.max(0, Math.floor(index * (text.length / Math.max(1, compact(text).length))) - 180);
      matches.push({
        position: null,
        track_id: null,
        title: null,
        artists: [alias],
        canonical_artist: target.canonical_artist,
        evidence_text: text.slice(rawIndex, rawIndex + 500),
      });
    }
  }

  return { entries: [], matches };
}

function parseMaybeJson(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed || (!trimmed.startsWith('{') && !trimmed.startsWith('['))) return null;
  try { return JSON.parse(trimmed); } catch { return null; }
}

export function parseNeteaseSnapshotBody(text, contentType = '') {
  const json = /json/i.test(contentType) ? parseMaybeJson(text) : parseMaybeJson(text);
  if (json) return { format: 'json', ...parseNeteaseJapanJson(json) };
  return { format: 'html', ...parseNeteaseJapanHtml(text) };
}

function yyyyMMdd(dateLike) {
  const date = dateLike instanceof Date ? dateLike : new Date(`${dateLike}T00:00:00Z`);
  if (!Number.isFinite(date.getTime())) throw new Error(`invalid date: ${dateLike}`);
  return date.toISOString().slice(0, 10).replaceAll('-', '');
}

function isoWeekKeyFromTimestamp(timestamp) {
  const match = String(timestamp).match(/^(\d{4})(\d{2})(\d{2})/);
  if (!match) return String(timestamp).slice(0, 8);
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  const weekday = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - weekday + 3);
  const isoYear = date.getUTCFullYear();
  const jan4 = new Date(Date.UTC(isoYear, 0, 4));
  const jan4Weekday = (jan4.getUTCDay() + 6) % 7;
  jan4.setUTCDate(jan4.getUTCDate() - jan4Weekday + 3);
  const week = 1 + Math.round((date - jan4) / 604_800_000);
  return `${isoYear}_${String(week).padStart(2, '0')}`;
}

export function parseCdxRows(payload) {
  if (!Array.isArray(payload) || payload.length < 2 || !Array.isArray(payload[0])) return [];
  const headers = payload[0];
  return payload.slice(1).filter(Array.isArray).map((row) => Object.fromEntries(headers.map((key, index) => [key, row[index] ?? null])));
}

export function selectWeeklySnapshots(rows = []) {
  const selected = new Map();
  for (const row of rows) {
    if (!row?.timestamp || !row?.original) continue;
    const key = `${isoWeekKeyFromTimestamp(row.timestamp)}|${row.original.replace(/^https?:/i, '')}`;
    const previous = selected.get(key);
    if (!previous || String(row.timestamp) > String(previous.timestamp)) selected.set(key, row);
  }
  return [...selected.values()].sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
}

async function fetchWithRetries(url, options = {}, retries = 3) {
  let error;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, { ...options, signal: AbortSignal.timeout(options.timeoutMs || 30_000) });
      if (response.status === 429 || response.status >= 500) throw new Error(`HTTP ${response.status}`);
      return response;
    } catch (caught) {
      error = caught;
      if (attempt < retries) await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
    }
  }
  throw error;
}

async function currentChartProbe() {
  const attempts = [];
  for (const url of CURRENT_ENDPOINTS) {
    try {
      const response = await fetchWithRetries(url, { headers: HEADERS }, 2);
      const text = await response.text();
      const parsed = response.ok ? parseNeteaseSnapshotBody(text, response.headers.get('content-type') || '') : null;
      const attempt = { url, status: response.status, ok: response.ok, parsed };
      attempts.push(attempt);
      if (response.ok && parsed?.format === 'json' && parsed.entries?.length) {
        return { ok: true, selected_url: url, attempts, ...parsed };
      }
    } catch (error) {
      attempts.push({ url, ok: false, error: String(error?.message || error) });
    }
  }
  return { ok: false, attempts, entries: [], matches: [] };
}

function cdxUrl(originalUrl, fromDate, toDate) {
  const url = new URL('https://web.archive.org/cdx/search/cdx');
  url.searchParams.set('url', originalUrl);
  url.searchParams.set('output', 'json');
  url.searchParams.set('fl', 'timestamp,original,statuscode,mimetype,digest,length');
  url.searchParams.append('filter', 'statuscode:200');
  url.searchParams.set('from', yyyyMMdd(fromDate));
  url.searchParams.set('to', yyyyMMdd(toDate));
  url.searchParams.set('collapse', 'digest');
  url.searchParams.set('limit', '2000');
  return url.toString();
}

async function loadCdxRows(originalUrl, fromDate, toDate) {
  const url = cdxUrl(originalUrl, fromDate, toDate);
  const response = await fetchWithRetries(url, { headers: { 'user-agent': HEADERS['user-agent'] }, timeoutMs: 45_000 }, 3);
  if (!response.ok) throw new Error(`CDX HTTP ${response.status}`);
  return parseCdxRows(await response.json());
}

async function enumerateArchivedSnapshots(fromDate, toDate) {
  const sources = [];
  const rows = [];
  for (const originalUrl of ARCHIVE_ENDPOINTS) {
    try {
      const found = await loadCdxRows(originalUrl, fromDate, toDate);
      sources.push({ original_url: originalUrl, ok: true, captures: found.length });
      rows.push(...found);
    } catch (error) {
      sources.push({ original_url: originalUrl, ok: false, captures: 0, error: String(error?.message || error) });
    }
  }
  const unique = new Map();
  for (const row of rows) unique.set(`${row.timestamp}|${row.original}`, row);
  return { sources, snapshots: selectWeeklySnapshots([...unique.values()]) };
}

function archivedSnapshotUrl(snapshot) {
  return `https://web.archive.org/web/${snapshot.timestamp}id_/${snapshot.original}`;
}

async function inspectSnapshot(snapshot) {
  const url = archivedSnapshotUrl(snapshot);
  const response = await fetchWithRetries(url, { headers: { 'user-agent': HEADERS['user-agent'] }, timeoutMs: 45_000 }, 2);
  if (!response.ok) throw new Error(`archive HTTP ${response.status}`);
  const text = await response.text();
  const parsed = parseNeteaseSnapshotBody(text, response.headers.get('content-type') || snapshot.mimetype || '');
  return {
    timestamp: snapshot.timestamp,
    iso_week: isoWeekKeyFromTimestamp(snapshot.timestamp),
    original_url: snapshot.original,
    archive_url: url,
    digest: snapshot.digest || null,
    format: parsed.format,
    update_time: parsed.update_time || null,
    track_count: parsed.track_count ?? parsed.entries?.length ?? null,
    matches: parsed.matches || [],
  };
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const output = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      try { output[index] = await mapper(items[index], index); }
      catch (error) { output[index] = { error: String(error?.message || error), input: items[index] }; }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, items.length || 1)) }, () => worker()));
  return output;
}

function dedupeMatches(records) {
  const seen = new Set();
  const output = [];
  for (const record of records) {
    if (!record?.matches?.length) continue;
    for (const match of record.matches) {
      const key = [record.iso_week, match.canonical_artist, match.position ?? '', match.track_id ?? '', match.title ?? ''].join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      output.push({
        timestamp: record.timestamp,
        iso_week: record.iso_week,
        archive_url: record.archive_url,
        original_url: record.original_url,
        format: record.format,
        ...match,
      });
    }
  }
  return output.sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)) || (a.position ?? 9999) - (b.position ?? 9999));
}

function countByArtist(matches) {
  const counts = Object.fromEntries(TARGETS.map((target) => [target.canonical_artist, 0]));
  for (const match of matches) counts[match.canonical_artist] = (counts[match.canonical_artist] || 0) + 1;
  return counts;
}

function markdownEscape(value) {
  return String(value ?? '').replaceAll('|', '\\|').replaceAll('\n', ' ');
}

export function renderMarkdownReport(report) {
  const lines = [
    '# NetEase Cloud Music 日本Oricon榜 historical investigation',
    '',
    `Generated: ${report.generated_at}`,
    `Range: ${report.range.from} – ${report.range.to}`,
    `Chart: ${report.chart.name} (playlist ${report.chart.id})`,
    '',
    '## Result',
    '',
    `- Current official endpoint reachable: ${report.current.ok ? 'yes' : 'no'}`,
    `- Archive captures selected for inspection: ${report.archive.selected_snapshots}`,
    `- Archive captures successfully parsed: ${report.archive.parsed_snapshots}`,
    `- Sakamichi match rows recovered: ${report.archive.matches.length}`,
    `- Match counts: ${Object.entries(report.archive.counts).map(([artist, count]) => `${artist}=${count}`).join(', ')}`,
    '',
  ];
  if (report.current.matches?.length) {
    lines.push('## Current chart matches', '', '| Rank | Artist | Track | Track ID |', '| ---: | --- | --- | --- |');
    for (const match of report.current.matches) {
      lines.push(`| ${match.position ?? '-'} | ${match.canonical_artist} | ${markdownEscape(match.title)} | ${match.track_id ?? '-'} |`);
    }
    lines.push('');
  }
  lines.push('## Historical matches', '');
  if (!report.archive.matches.length) {
    lines.push('No structured Sakamichi matches were recovered from the archive captures inspected.', '');
  } else {
    lines.push('| Capture | ISO week | Rank | Artist | Track | Evidence |', '| --- | --- | ---: | --- | --- | --- |');
    for (const match of report.archive.matches) {
      lines.push(`| ${match.timestamp} | ${match.iso_week} | ${match.position ?? '-'} | ${match.canonical_artist} | ${markdownEscape(match.title || '-')} | ${match.archive_url} |`);
    }
    lines.push('');
  }
  lines.push(
    '## Notes',
    '',
    '- NetEase chart 60131 is a mutable playlist. Unlike QQ Music 日本榜, no documented provider-side historical `period` parameter was found for this chart.',
    '- The investigation therefore treats archived copies of NetEase playlist/API responses as evidence. A missing archive match is not proof that a song never charted.',
    '- Legacy names 欅坂46 and けやき坂46 are included and normalized to the successor-group buckets for historical continuity.',
    '',
  );
  return `${lines.join('\n')}\n`;
}

function cliValue(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

async function main() {
  const from = cliValue('--from', process.env.NETEASE_HISTORY_FROM || DEFAULT_FROM_DATE);
  const to = cliValue('--to', process.env.NETEASE_HISTORY_TO || new Date().toISOString().slice(0, 10));
  const outputJson = cliValue('--output-json', process.env.NETEASE_HISTORY_OUTPUT_JSON || 'netease-japan-history-result.json');
  const outputMarkdown = cliValue('--output-markdown', process.env.NETEASE_HISTORY_OUTPUT_MARKDOWN || 'netease-japan-history-result.md');

  const current = await currentChartProbe();
  const archiveIndex = await enumerateArchivedSnapshots(from, to);
  const inspected = await mapWithConcurrency(archiveIndex.snapshots, 4, async (snapshot, index) => {
    if (index && index % 25 === 0) console.log(JSON.stringify({ event: 'netease_history_progress', inspected: index, total: archiveIndex.snapshots.length }));
    return inspectSnapshot(snapshot);
  });
  const parsed = inspected.filter((entry) => entry && !entry.error);
  const failures = inspected.filter((entry) => entry?.error);
  const matches = dedupeMatches(parsed);

  const report = {
    version: 1,
    generated_at: new Date().toISOString(),
    range: { from, to },
    chart: { id: NETEASE_JAPAN_CHART_ID, name: NETEASE_JAPAN_CHART_NAME },
    targets: TARGETS,
    current: {
      ok: current.ok,
      selected_url: current.selected_url || null,
      update_time: current.update_time || null,
      track_count: current.track_count ?? current.entries?.length ?? 0,
      matches: current.matches || [],
      attempts: current.attempts || [],
    },
    archive: {
      sources: archiveIndex.sources,
      selected_snapshots: archiveIndex.snapshots.length,
      parsed_snapshots: parsed.length,
      failed_snapshots: failures.length,
      counts: countByArtist(matches),
      matches,
      failures: failures.slice(0, 50),
    },
  };

  await writeFile(outputJson, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await writeFile(outputMarkdown, renderMarkdownReport(report), 'utf8');
  console.log(JSON.stringify({
    event: 'netease_japan_history_complete',
    current_ok: report.current.ok,
    selected_snapshots: report.archive.selected_snapshots,
    parsed_snapshots: report.archive.parsed_snapshots,
    failed_snapshots: report.archive.failed_snapshots,
    counts: report.archive.counts,
    matches: report.archive.matches.length,
  }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
}
