import { writeFile } from 'node:fs/promises';

const OUT = 'netease-japan-arquivo.json';
const CHART_ID = '5059644681';
const BASE = 'https://arquivo.pt/textsearch';

const urlCandidates = [
  `https://music.163.com/playlist?id=${CHART_ID}`,
  `http://music.163.com/playlist?id=${CHART_ID}`,
  `https://music.163.com/discover/toplist?id=${CHART_ID}`,
  `http://music.163.com/discover/toplist?id=${CHART_ID}`,
  `https://music.163.com/api/v6/playlist/detail?id=${CHART_ID}`,
  `http://music.163.com/api/v6/playlist/detail?id=${CHART_ID}`,
  `https://music.163.com/api/playlist/detail?id=${CHART_ID}`,
  `http://music.163.com/api/playlist/detail?id=${CHART_ID}`,
];

const targetGroups = [
  { key: 'nogizaka46', names: ['乃木坂46', 'Nogizaka46', 'Nogizaka 46'] },
  { key: 'sakurazaka46', names: ['櫻坂46', '樱坂46', 'Sakurazaka46', 'Sakurazaka 46'] },
  { key: 'hinatazaka46', names: ['日向坂46', 'Hinatazaka46', 'Hinatazaka 46'] },
  { key: 'keyakizaka46', names: ['欅坂46', '榉坂46', 'Keyakizaka46', 'Keyakizaka 46'] },
  { key: 'hiragana-keyaki', names: ['けやき坂46', '平假名欅坂46', 'Hiragana Keyakizaka46', 'Hiragana Keyaki'] },
];

const textQueries = [
  `"${CHART_ID}"`,
  '"云音乐日语榜"',
  '"网易云日语榜"',
  '"乃木坂46" "日语榜"',
  '"櫻坂46" "日语榜"',
  '"樱坂46" "日语榜"',
  '"日向坂46" "日语榜"',
  '"欅坂46" "日语榜"',
  '"榉坂46" "日语榜"',
];

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchText(url, { timeoutMs = 20000, retries = 2 } = {}) {
  let last;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        signal: ac.signal,
        headers: {
          'user-agent': 'Mozilla/5.0 NetEase-Japan-chart-history-research/1.0',
          accept: 'application/json,text/plain,text/html,*/*',
        },
        redirect: 'follow',
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
      return { status: res.status, url: res.url, text };
    } catch (err) {
      last = err;
      if (attempt < retries) await sleep(750 * (attempt + 1));
    } finally {
      clearTimeout(timer);
    }
  }
  throw last;
}

function absUrl(value) {
  if (!value) return null;
  try { return new URL(value, 'https://arquivo.pt').href; } catch { return null; }
}

async function arquivoSearch(params, maxPages = 40) {
  const all = [];
  const errors = [];
  let estimated = null;
  for (let page = 0; page < maxPages; page++) {
    const u = new URL(BASE);
    for (const [k, v] of Object.entries({ ...params, offset: page * 50, maxItems: 50 })) {
      u.searchParams.set(k, String(v));
    }
    try {
      const r = await fetchText(u.href, { timeoutMs: 20000, retries: 2 });
      const j = JSON.parse(r.text);
      const items = Array.isArray(j.response_items) ? j.response_items : [];
      estimated ??= j.estimated_nr_results ?? null;
      all.push(...items);
      console.log('SEARCH', params.versionHistory || params.q, 'page', page + 1, 'items', items.length, 'estimated', estimated);
      if (items.length < 50) break;
      if (estimated != null && all.length >= Number(estimated)) break;
    } catch (err) {
      errors.push({ page, error: String(err) });
      console.warn('SEARCH_ERROR', params.versionHistory || params.q, page, String(err));
      break;
    }
  }
  return { estimated, items: all, errors };
}

function groupMatches(text) {
  const lower = text.toLowerCase();
  return targetGroups
    .filter(g => g.names.some(n => lower.includes(n.toLowerCase())))
    .map(g => g.key);
}

function compactContext(text, names, radius = 450) {
  const lower = text.toLowerCase();
  const positions = [];
  for (const name of names) {
    let p = lower.indexOf(name.toLowerCase());
    while (p >= 0 && positions.length < 12) {
      positions.push({ p, name });
      p = lower.indexOf(name.toLowerCase(), p + name.length);
    }
  }
  positions.sort((a, b) => a.p - b.p);
  return positions.slice(0, 8).map(({ p, name }) => ({
    match: name,
    context: text.slice(Math.max(0, p - radius), Math.min(text.length, p + name.length + radius))
      .replace(/\s+/g, ' '),
  }));
}

function artistNames(track) {
  const arr = track?.ar || track?.artists || [];
  if (!Array.isArray(arr)) return [];
  return arr.map(x => typeof x === 'string' ? x : x?.name).filter(Boolean);
}

function scanJsonForRankedTracks(value) {
  const hits = [];
  const seenArrays = new Set();
  function walk(node, path = '$') {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      const looksLikeTracks = node.length > 0 && node.some(x => x && typeof x === 'object' && (x.name || x.first) && (x.ar || x.artists || x.second));
      if (looksLikeTracks && !seenArrays.has(node)) {
        seenArrays.add(node);
        node.forEach((track, i) => {
          const title = track?.name || track?.first || null;
          const artists = artistNames(track);
          if (!artists.length && track?.second) artists.push(track.second);
          const hay = `${title || ''} ${artists.join(' ')}`;
          const groups = groupMatches(hay);
          if (groups.length) hits.push({ rank: i + 1, title, artists, groups, path });
        });
      }
      node.forEach((x, i) => walk(x, `${path}[${i}]`));
      return;
    }
    for (const [k, v] of Object.entries(node)) walk(v, `${path}.${k}`);
  }
  walk(value);
  return hits;
}

function parseEmbeddedJson(text) {
  const candidates = [];
  const trimmed = text.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) candidates.push(trimmed);
  const regexes = [
    /<textarea[^>]+id=["']song-list-pre-data["'][^>]*>([\s\S]*?)<\/textarea>/gi,
    /<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/gi,
  ];
  for (const re of regexes) {
    for (const m of text.matchAll(re)) candidates.push(m[1].replaceAll('&quot;', '"').replaceAll('&amp;', '&'));
  }
  const parsed = [];
  for (const c of candidates) {
    try { parsed.push(JSON.parse(c)); } catch {}
  }
  return parsed;
}

const versionResults = [];
for (const candidate of urlCandidates) {
  const r = await arquivoSearch({ versionHistory: candidate, from: 2020, to: 2026 });
  versionResults.push({ candidate, ...r });
}

const textResults = [];
for (const q of textQueries) {
  const r = await arquivoSearch({ q, from: 2020, to: 2026 }, 10);
  textResults.push({ q, ...r });
}

const itemMap = new Map();
for (const block of [...versionResults, ...textResults]) {
  for (const item of block.items) {
    const key = `${item.tstamp || ''}|${item.originalURL || ''}|${item.digest || ''}`;
    if (!itemMap.has(key)) itemMap.set(key, item);
  }
}

const captures = [];
const exactHits = [];
for (const item of itemMap.values()) {
  const links = [...new Set([
    absUrl(item.linkToOriginalFile),
    absUrl(item.linkToExtractedText),
    absUrl(item.linkToNoFrame),
  ].filter(Boolean))];
  const cap = {
    tstamp: item.tstamp ?? null,
    originalURL: item.originalURL ?? null,
    statusCode: item.statusCode ?? null,
    mimeType: item.mimeType ?? null,
    digest: item.digest ?? null,
    links,
    fetched: [],
    groups: [],
    rankedHits: [],
    contexts: [],
  };
  for (const link of links.slice(0, 3)) {
    try {
      const r = await fetchText(link, { timeoutMs: 15000, retries: 1 });
      const text = r.text;
      const groups = groupMatches(text);
      cap.fetched.push({ link, status: r.status, bytes: Buffer.byteLength(text), groups });
      cap.groups.push(...groups);
      if (groups.length) {
        const names = targetGroups.filter(g => groups.includes(g.key)).flatMap(g => g.names);
        cap.contexts.push(...compactContext(text, names));
      }
      for (const parsed of parseEmbeddedJson(text)) {
        cap.rankedHits.push(...scanJsonForRankedTracks(parsed));
      }
    } catch (err) {
      cap.fetched.push({ link, error: String(err) });
    }
  }
  cap.groups = [...new Set(cap.groups)];
  const rankKey = new Set();
  cap.rankedHits = cap.rankedHits.filter(h => {
    const k = `${h.rank}|${h.title}|${h.artists.join('|')}|${h.groups.join('|')}`;
    if (rankKey.has(k)) return false;
    rankKey.add(k); return true;
  });
  if (cap.groups.length || cap.rankedHits.length) exactHits.push(cap);
  captures.push(cap);
  if (captures.length % 25 === 0) console.log('FETCHED_CAPTURES', captures.length, 'HIT_CAPTURES', exactHits.length);
  await sleep(100);
}

const report = {
  generatedAt: new Date().toISOString(),
  chartId: CHART_ID,
  chartName: '网易云日语榜',
  targetGroups,
  summary: {
    versionHistoryQueries: versionResults.length,
    fullTextQueries: textResults.length,
    discoveredItems: [...versionResults, ...textResults].reduce((n, x) => n + x.items.length, 0),
    uniqueCaptures: captures.length,
    hitCaptures: exactHits.length,
    exactRankHits: exactHits.reduce((n, x) => n + x.rankedHits.length, 0),
  },
  versionResults: versionResults.map(x => ({ candidate: x.candidate, estimated: x.estimated, count: x.items.length, errors: x.errors })),
  textResults: textResults.map(x => ({ q: x.q, estimated: x.estimated, count: x.items.length, errors: x.errors })),
  exactHits,
  captures,
};

await writeFile(OUT, JSON.stringify(report, null, 2));
console.log('SUMMARY', JSON.stringify(report.summary));
for (const hit of exactHits) {
  console.log('HIT', JSON.stringify({ tstamp: hit.tstamp, originalURL: hit.originalURL, groups: hit.groups, rankedHits: hit.rankedHits }));
}
