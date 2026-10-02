import { mkdir, writeFile } from 'node:fs/promises';

const outDir = '../kkbox-probe-evidence';
await mkdir(outDir, { recursive: true });

const territories = ['tw', 'hk'];
const periods = ['daily', 'weekly'];
const types = ['song', 'newrelease'];
const historicalDates = [
  '2026-10-02',
  '2025-10-03',
  '2024-10-03',
  '2023-10-03',
  '2022-10-03',
  '2021-10-03',
  '2020-10-03',
  '2019-10-03',
  '2018-10-03',
];
const targetArtists = [
  '櫻坂46', 'Sakurazaka46', 'Sakurazaka 46',
  '乃木坂46', 'Nogizaka46', 'Nogizaka 46',
  '日向坂46', 'Hinatazaka46', 'Hinatazaka 46',
  '欅坂46', 'Keyakizaka46', 'Keyakizaka 46',
];

function findRows(value, path = '$', found = []) {
  if (Array.isArray(value)) {
    if (value.some((item) => item && typeof item === 'object' && (
      'song_name' in item || 'artist_name' in item || 'rankings' in item || 'ranking' in item
    ))) found.push({ path, rows: value });
    value.forEach((item, index) => findRows(item, `${path}[${index}]`, found));
  } else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) findRows(item, `${path}.${key}`, found);
  }
  return found;
}

function normalizeRow(row) {
  const rank = row?.rankings?.this_period ?? row?.ranking ?? row?.rank ?? row?.position ?? null;
  const title = row?.song_name ?? row?.track_name ?? row?.name ?? row?.title ?? null;
  const artist = row?.artist_name ?? row?.artist?.name ?? row?.artist ?? null;
  const url = row?.song_url ?? row?.url ?? row?.web_url ?? null;
  return { rank, title, artist, url };
}

function matchTarget(row) {
  const haystack = `${row?.artist_name ?? ''} ${row?.artist?.name ?? ''} ${row?.song_name ?? ''} ${row?.name ?? ''}`.toLowerCase();
  return targetArtists.some((name) => haystack.includes(name.toLowerCase()));
}

async function fetchText(url, timeoutMs = 15_000) {
  const response = await fetch(url, {
    headers: {
      accept: 'application/json,text/plain,text/html,*/*',
      'accept-language': 'zh-TW,zh;q=0.9,en;q=0.8,ja;q=0.7',
      'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140 Safari/537.36',
      referer: 'https://kma.kkbox.com/',
    },
    signal: AbortSignal.timeout(timeoutMs),
    redirect: 'follow',
  });
  return { response, text: await response.text() };
}

const cases = [];
for (const terr of territories) {
  for (const period of periods) {
    for (const type of types) {
      cases.push({ terr, period, type, date: null });
      for (const date of historicalDates) cases.push({ terr, period, type, date });
    }
  }
}

const results = [];
let cursor = 0;
const workers = Array.from({ length: 6 }, async () => {
  while (cursor < cases.length) {
    const item = cases[cursor++];
    const params = new URLSearchParams({
      category: '308',
      lang: 'tc',
      limit: '100',
      terr: item.terr,
      type: item.type,
    });
    if (item.date) params.set('date', item.date);
    const url = `https://kma.kkbox.com/charts/api/v1/${item.period}?${params}`;
    const started = Date.now();
    try {
      const { response, text } = await fetchText(url);
      let json = null;
      let parseError = null;
      try { json = JSON.parse(text); } catch (error) { parseError = error.message; }
      const rowSets = json ? findRows(json) : [];
      const largest = rowSets.sort((a, b) => b.rows.length - a.rows.length)[0] ?? null;
      const rows = largest?.rows ?? [];
      const matches = rows.filter(matchTarget).map(normalizeRow);
      const result = {
        ...item,
        url,
        status: response.status,
        final_url: response.url,
        content_type: response.headers.get('content-type'),
        elapsed_ms: Date.now() - started,
        json: Boolean(json),
        parse_error: parseError,
        row_path: largest?.path ?? null,
        row_count: rows.length,
        sample: rows.slice(0, 3).map(normalizeRow),
        sakamichi_matches: matches,
        body_prefix: json ? null : text.slice(0, 500),
      };
      results.push(result);
      if (!item.date && response.ok) {
        const safe = `${item.terr}-${item.period}-${item.type}`;
        await writeFile(`${outDir}/${safe}.txt`, text.slice(0, 500_000));
      }
      console.log(JSON.stringify({ terr:item.terr, period:item.period, type:item.type, date:item.date ?? 'current', status:response.status, json:Boolean(json), rows:rows.length, matches:matches.length }));
    } catch (error) {
      results.push({ ...item, url, error: error.message, elapsed_ms: Date.now() - started });
      console.log(JSON.stringify({ terr:item.terr, period:item.period, type:item.type, date:item.date ?? 'current', error:error.message }));
    }
  }
});
await Promise.all(workers);

// If the historical JSON API moved, capture the chart shell and discover current script references.
const pageProbes = [];
for (const terr of territories) {
  for (const period of periods) {
    const url = `https://kma.kkbox.com/charts/${period}/song?cate=308&lang=tc&terr=${terr}`;
    try {
      const { response, text } = await fetchText(url, 20_000);
      const scripts = [...text.matchAll(/<script\b[^>]*src=["']([^"']+)["']/gi)]
        .map((match) => new URL(match[1], response.url).href);
      const apiHints = [...new Set([
        ...text.matchAll(/\/charts\/api\/[^"'\\\s<]+/g),
      ].map((match) => match[0]))].slice(0, 30);
      pageProbes.push({ terr, period, url, status:response.status, final_url:response.url, content_type:response.headers.get('content-type'), scripts, api_hints:apiHints, body_prefix:text.slice(0, 1000) });
      await writeFile(`${outDir}/page-${terr}-${period}.html`, text.slice(0, 1_000_000));
    } catch (error) {
      pageProbes.push({ terr, period, url, error:error.message });
    }
  }
}

const successful = results.filter((item) => item.status >= 200 && item.status < 300 && item.json && item.row_count > 0);
const historicalSuccessful = successful.filter((item) => item.date);
const earliestBySeries = {};
for (const item of historicalSuccessful) {
  const key = `${item.terr}/${item.period}/${item.type}`;
  if (!earliestBySeries[key] || item.date < earliestBySeries[key]) earliestBySeries[key] = item.date;
}
const matches = results.flatMap((item) => (item.sakamichi_matches ?? []).map((match) => ({
  terr:item.terr, period:item.period, type:item.type, date:item.date, ...match,
})));

const report = {
  generated_at: new Date().toISOString(),
  category: 308,
  target: 'Japanese charts; Sakurazaka46/Nogizaka46/Hinatazaka46/Keyakizaka46',
  totals: {
    cases: results.length,
    http_2xx_with_rows: successful.length,
    historical_2xx_with_rows: historicalSuccessful.length,
    sakamichi_matches: matches.length,
  },
  earliest_tested_success_by_series: earliestBySeries,
  matches,
  results: results.sort((a,b) => `${a.terr}${a.period}${a.type}${a.date ?? ''}`.localeCompare(`${b.terr}${b.period}${b.type}${b.date ?? ''}`)),
  page_probes: pageProbes,
};
await writeFile(`${outDir}/report.json`, JSON.stringify(report, null, 2));
console.log('KKBOX_PROBE_SUMMARY=' + JSON.stringify(report.totals));
console.log('KKBOX_EARLIEST=' + JSON.stringify(earliestBySeries));
console.log('KKBOX_MATCHES=' + JSON.stringify(matches.slice(0, 100)));
