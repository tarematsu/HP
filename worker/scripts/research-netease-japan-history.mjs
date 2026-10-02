import { writeFile } from 'node:fs/promises';
import { gunzipSync, inflateSync } from 'node:zlib';

const CHART_ID = '5059644681';
const CHART_CREATED_AT = '2020-06-11';
const USER_AGENT = 'Mozilla/5.0 compatible; skrzk-pages-netease-history-research/1.0';
const REQUEST_TIMEOUT_MS = 30_000;
const REQUEST_DELAY_MS = 150;
const MAX_WAYBACK_CAPTURES_PER_URL = 400;

const TARGETS = Object.freeze([
  {
    canonical_artist: 'sakurazaka46',
    names: ['櫻坂46', '樱坂46', 'Sakurazaka46', 'SAKURAZAKA46'],
  },
  {
    canonical_artist: 'nogizaka46',
    names: ['乃木坂46', 'Nogizaka46', 'NOGIZAKA46'],
  },
  {
    canonical_artist: 'hinatazaka46',
    names: ['日向坂46', 'Hinatazaka46', 'HINATAZAKA46'],
  },
]);

const SOURCE_URLS = [
  `https://music.163.com/playlist?id=${CHART_ID}`,
  `https://music.163.com/discover/toplist?id=${CHART_ID}`,
  `https://music.163.com/api/v6/playlist/detail?id=${CHART_ID}`,
  `https://music.163.com/api/playlist/detail?id=${CHART_ID}`,
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchResponse(url, init = {}, retries = 2) {
  let lastError;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...init,
        headers: {
          'user-agent': USER_AGENT,
          accept: '*/*',
          ...(init.headers || {}),
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response;
    } catch (error) {
      lastError = error;
      if (attempt < retries) await sleep(500 * attempt);
    }
  }
  throw lastError;
}

async function fetchText(url, init = {}, retries = 2) {
  return (await fetchResponse(url, init, retries)).text();
}

function decodeHtmlEntities(value) {
  return String(value || '')
    .replaceAll('&quot;', '"')
    .replaceAll('&#34;', '"')
    .replaceAll('&#x22;', '"')
    .replaceAll('&amp;', '&')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>');
}

function parseJsonLoose(text) {
  const source = String(text || '').replace(/^\uFEFF/, '').trim();
  if (!source) return null;
  try { return JSON.parse(source); } catch {}
  return null;
}

function songArtists(song) {
  const artists = song?.ar || song?.artists || song?.artist || [];
  if (Array.isArray(artists)) {
    return artists.map((item) => typeof item === 'string' ? item : item?.name).filter(Boolean);
  }
  if (typeof artists === 'string') return [artists];
  if (artists?.name) return [artists.name];
  return [];
}

function songId(song) {
  return String(song?.id ?? song?.songId ?? song?.trackId ?? song?.service_track_id ?? '');
}

function songTitle(song) {
  return song?.name ?? song?.title ?? song?.songName ?? null;
}

function canonicalArtistForNames(names = []) {
  const haystack = names.join(' / ').normalize('NFKC').toLowerCase();
  for (const target of TARGETS) {
    if (target.names.some((name) => haystack.includes(name.normalize('NFKC').toLowerCase()))) {
      return target.canonical_artist;
    }
  }
  return null;
}

function extractTrackArrayFromJson(payload) {
  const candidates = [
    payload?.playlist?.tracks,
    payload?.playlist?.trackIds,
    payload?.result?.tracks,
    payload?.data?.playlist?.tracks,
    payload?.data?.tracks,
    payload?.tracks,
  ];
  return candidates.find((value) => Array.isArray(value) && value.length) || null;
}

function extractTrackArrayFromHtml(html) {
  const source = String(html || '');
  const textareaPatterns = [
    /<textarea[^>]+id=["']song-list-pre-data["'][^>]*>([\s\S]*?)<\/textarea>/i,
    /<textarea[^>]+class=["'][^"']*song-list-pre-data[^"']*["'][^>]*>([\s\S]*?)<\/textarea>/i,
  ];
  for (const pattern of textareaPatterns) {
    const match = source.match(pattern);
    if (!match) continue;
    const parsed = parseJsonLoose(decodeHtmlEntities(match[1]));
    if (Array.isArray(parsed) && parsed.length) return parsed;
  }

  for (const marker of ['"tracks"', '"trackIds"']) {
    const markerIndex = source.indexOf(marker);
    if (markerIndex < 0) continue;
    const arrayStart = source.indexOf('[', markerIndex);
    if (arrayStart < 0) continue;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = arrayStart; index < source.length; index += 1) {
      const char = source[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') { inString = true; continue; }
      if (char === '[') depth += 1;
      if (char === ']') {
        depth -= 1;
        if (depth === 0) {
          const parsed = parseJsonLoose(source.slice(arrayStart, index + 1));
          if (Array.isArray(parsed) && parsed.length) return parsed;
          break;
        }
      }
    }
  }
  return null;
}

function extractTracks(body) {
  const json = parseJsonLoose(body);
  if (json) {
    const tracks = extractTrackArrayFromJson(json);
    if (tracks) return { tracks, format: 'json' };
  }
  const tracks = extractTrackArrayFromHtml(body);
  if (tracks) return { tracks, format: 'html' };
  return { tracks: null, format: json ? 'json-unparsed' : 'unknown' };
}

function rankRows(tracks = []) {
  return tracks.map((song, index) => ({
    rank: index + 1,
    track_id: songId(song),
    title: songTitle(song),
    artists: songArtists(song),
    canonical_artist: canonicalArtistForNames(songArtists(song)),
  }));
}

function normalizeCaptureDate(timestamp) {
  const value = String(timestamp || '');
  return /^\d{14}$/.test(value)
    ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`
    : null;
}

function dedupeHits(hits = []) {
  const map = new Map();
  for (const hit of hits) {
    const key = [hit.capture_date, hit.canonical_artist, hit.rank, hit.track_id, hit.title].join('|');
    if (!map.has(key)) map.set(key, hit);
  }
  return [...map.values()].sort((a, b) =>
    String(a.capture_date).localeCompare(String(b.capture_date))
    || a.rank - b.rank
    || String(a.title || '').localeCompare(String(b.title || '')));
}

async function fetchCurrentChart() {
  const url = `https://music.163.com/api/v6/playlist/detail?id=${CHART_ID}`;
  try {
    const text = await fetchText(url, {
      headers: { referer: 'https://music.163.com/' },
    });
    const extracted = extractTracks(text);
    return {
      ok: Boolean(extracted.tracks),
      url,
      format: extracted.format,
      track_count: extracted.tracks?.length ?? 0,
      hits: rankRows(extracted.tracks || []).filter((row) => row.canonical_artist),
    };
  } catch (error) {
    return { ok: false, url, error: String(error?.message || error), track_count: 0, hits: [] };
  }
}

function cdxUrl(sourceUrl) {
  const params = new URLSearchParams({
    url: sourceUrl,
    output: 'json',
    fl: 'timestamp,original,statuscode,mimetype,digest',
    filter: 'statuscode:200',
    collapse: 'digest',
    from: CHART_CREATED_AT.slice(0, 4),
    to: String(new Date().getUTCFullYear()),
    limit: String(MAX_WAYBACK_CAPTURES_PER_URL),
  });
  return `https://web.archive.org/cdx/search/cdx?${params}`;
}

async function queryWaybackCaptures(sourceUrl) {
  const text = await fetchText(cdxUrl(sourceUrl), {}, 3);
  const rows = parseJsonLoose(text);
  if (!Array.isArray(rows) || rows.length < 2) return [];
  const [header, ...values] = rows;
  return values.map((row) => Object.fromEntries(header.map((key, index) => [key, row[index]])));
}

async function probeWayback() {
  const captures = [];
  const errors = [];
  for (const sourceUrl of SOURCE_URLS) {
    try {
      const rows = await queryWaybackCaptures(sourceUrl);
      captures.push(...rows.map((row) => ({ ...row, source_url: sourceUrl })));
    } catch (error) {
      errors.push({ source_url: sourceUrl, error: String(error?.message || error) });
    }
  }

  const unique = [...new Map(captures.map((item) => [`${item.timestamp}|${item.original}|${item.digest}`, item])).values()]
    .sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
  const snapshots = [];
  const hits = [];

  for (const capture of unique) {
    const archivedUrl = `https://web.archive.org/web/${capture.timestamp}id_/${capture.original}`;
    try {
      const body = await fetchText(archivedUrl, {}, 2);
      const extracted = extractTracks(body);
      const rows = rankRows(extracted.tracks || []);
      const captureDate = normalizeCaptureDate(capture.timestamp);
      snapshots.push({
        capture_date: captureDate,
        timestamp: capture.timestamp,
        original: capture.original,
        format: extracted.format,
        track_count: rows.length,
        digest: capture.digest,
      });
      for (const row of rows.filter((item) => item.canonical_artist)) {
        hits.push({
          source: 'wayback',
          capture_date: captureDate,
          timestamp: capture.timestamp,
          original: capture.original,
          ...row,
        });
      }
    } catch (error) {
      snapshots.push({
        capture_date: normalizeCaptureDate(capture.timestamp),
        timestamp: capture.timestamp,
        original: capture.original,
        digest: capture.digest,
        error: String(error?.message || error),
      });
    }
    await sleep(REQUEST_DELAY_MS);
  }

  return {
    capture_count: unique.length,
    parsed_snapshot_count: snapshots.filter((item) => item.track_count > 0).length,
    snapshots,
    hits: dedupeHits(hits),
    errors,
  };
}

function commonCrawlYear(index) {
  const match = String(index?.id || '').match(/CC-MAIN-(\d{4})-/);
  return match ? Number(match[1]) : null;
}

async function commonCrawlIndexes() {
  const response = await fetchResponse('https://index.commoncrawl.org/collinfo.json', {}, 3);
  const indexes = await response.json();
  return (Array.isArray(indexes) ? indexes : [])
    .filter((item) => Number(commonCrawlYear(item)) >= Number(CHART_CREATED_AT.slice(0, 4)))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

async function queryCommonCrawlIndex(index, sourceUrl) {
  const params = new URLSearchParams({ url: sourceUrl, output: 'json', filter: 'status:200', collapse: 'digest' });
  const url = `${index['cdx-api']}?${params}`;
  const text = await fetchText(url, {}, 2);
  return text.split(/\r?\n/).map((line) => parseJsonLoose(line)).filter(Boolean);
}

function splitHttpPayload(buffer) {
  const text = buffer.toString('latin1');
  const first = text.indexOf('\r\n\r\n');
  if (first < 0) return buffer;
  const second = text.indexOf('\r\n\r\n', first + 4);
  if (second < 0) return buffer.subarray(first + 4);
  const headers = text.slice(first + 4, second).toLowerCase();
  let body = buffer.subarray(second + 4);
  if (headers.includes('content-encoding: gzip')) {
    try { body = gunzipSync(body); } catch {}
  } else if (headers.includes('content-encoding: deflate')) {
    try { body = inflateSync(body); } catch {}
  }
  return body;
}

async function fetchCommonCrawlCapture(capture) {
  const offset = Number(capture.offset);
  const length = Number(capture.length);
  if (!Number.isFinite(offset) || !Number.isFinite(length) || !capture.filename) {
    throw new Error('invalid Common Crawl capture coordinates');
  }
  const response = await fetchResponse(`https://data.commoncrawl.org/${capture.filename}`, {
    headers: { range: `bytes=${offset}-${offset + length - 1}` },
  }, 3);
  let bytes = Buffer.from(await response.arrayBuffer());
  try { bytes = gunzipSync(bytes); } catch {}
  return splitHttpPayload(bytes).toString('utf8');
}

async function probeCommonCrawl() {
  const errors = [];
  let indexes = [];
  try {
    indexes = await commonCrawlIndexes();
  } catch (error) {
    return { index_count: 0, capture_count: 0, parsed_snapshot_count: 0, snapshots: [], hits: [], errors: [{ error: String(error?.message || error) }] };
  }

  const captures = [];
  for (const index of indexes) {
    for (const sourceUrl of SOURCE_URLS) {
      try {
        const rows = await queryCommonCrawlIndex(index, sourceUrl);
        for (const row of rows) captures.push({ ...row, index: index.id, source_url: sourceUrl });
      } catch (error) {
        errors.push({ index: index.id, source_url: sourceUrl, error: String(error?.message || error) });
      }
    }
  }

  const unique = [...new Map(captures.map((item) => [
    `${item.timestamp}|${item.url}|${item.digest}|${item.filename}|${item.offset}`,
    item,
  ])).values()].sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
  const snapshots = [];
  const hits = [];

  for (const capture of unique) {
    try {
      const body = await fetchCommonCrawlCapture(capture);
      const extracted = extractTracks(body);
      const rows = rankRows(extracted.tracks || []);
      const captureDate = normalizeCaptureDate(capture.timestamp);
      snapshots.push({
        capture_date: captureDate,
        timestamp: capture.timestamp,
        url: capture.url,
        index: capture.index,
        format: extracted.format,
        track_count: rows.length,
        digest: capture.digest,
      });
      for (const row of rows.filter((item) => item.canonical_artist)) {
        hits.push({
          source: 'commoncrawl',
          capture_date: captureDate,
          timestamp: capture.timestamp,
          original: capture.url,
          ...row,
        });
      }
    } catch (error) {
      snapshots.push({
        capture_date: normalizeCaptureDate(capture.timestamp),
        timestamp: capture.timestamp,
        url: capture.url,
        index: capture.index,
        digest: capture.digest,
        error: String(error?.message || error),
      });
    }
    await sleep(REQUEST_DELAY_MS);
  }

  return {
    index_count: indexes.length,
    capture_count: unique.length,
    parsed_snapshot_count: snapshots.filter((item) => item.track_count > 0).length,
    snapshots,
    hits: dedupeHits(hits),
    errors,
  };
}

function summarizeHits(hits = []) {
  const grouped = {};
  for (const target of TARGETS) grouped[target.canonical_artist] = [];
  for (const hit of hits) grouped[hit.canonical_artist]?.push(hit);
  return Object.fromEntries(Object.entries(grouped).map(([artist, rows]) => [artist, {
    count: rows.length,
    earliest: rows[0]?.capture_date ?? null,
    latest: rows.at(-1)?.capture_date ?? null,
    best_rank: rows.length ? Math.min(...rows.map((row) => Number(row.rank))) : null,
    tracks: [...new Set(rows.map((row) => row.title).filter(Boolean))],
  }]));
}

async function main() {
  const startedAt = Date.now();
  const current = await fetchCurrentChart();
  const wayback = await probeWayback();
  const commoncrawl = await probeCommonCrawl();
  const hits = dedupeHits([...(wayback.hits || []), ...(commoncrawl.hits || [])]);
  const report = {
    generated_at: new Date().toISOString(),
    chart_id: CHART_ID,
    chart_created_at: CHART_CREATED_AT,
    targets: TARGETS,
    current,
    wayback,
    commoncrawl,
    hits,
    summary: summarizeHits(hits),
    elapsed_ms: Date.now() - startedAt,
  };

  await writeFile('netease-japan-history-research.json', `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({
    event: 'netease_japan_history_research_complete',
    current_track_count: current.track_count,
    wayback_captures: wayback.capture_count,
    wayback_parsed: wayback.parsed_snapshot_count,
    commoncrawl_indexes: commoncrawl.index_count,
    commoncrawl_captures: commoncrawl.capture_count,
    commoncrawl_parsed: commoncrawl.parsed_snapshot_count,
    hits: hits.length,
    summary: report.summary,
    elapsed_ms: report.elapsed_ms,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
