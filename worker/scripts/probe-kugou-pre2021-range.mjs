const RANK_ID = 31312;
const START = 47500;
const END = 48140;
const CONCURRENCY = 32;
const headers = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36',
  accept: 'text/html,application/xhtml+xml',
};

function extractJsonArrayAfter(text, marker) {
  const markerIndex = text.indexOf(marker);
  if (markerIndex < 0) return null;
  const start = text.indexOf('[', markerIndex + marker.length);
  if (start < 0) return null;
  let depth = 0, inString = false, escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === '[') depth += 1;
    else if (ch === ']' && --depth === 0) return text.slice(start, i + 1);
  }
  return null;
}

function inspect(text) {
  const date = text.match(/(20\d{2})[-\/.年](\d{1,2})[-\/.月](\d{1,2})/)?.[0] || null;
  const raw = extractJsonArrayAfter(text, 'global.features');
  let featureCount = 0;
  try { featureCount = raw ? JSON.parse(raw).length : 0; } catch {}
  const links = [...text.matchAll(/\/rank\/home\/1-31312-(\d+)\.html/gi)].map(m => Number(m[1])).filter(Number.isFinite);
  return { date, feature_count: featureCount, linked_volids: [...new Set(links)].sort((a,b)=>a-b) };
}

async function probe(volid) {
  const url = `https://pc.service.kugou.com/yueku/v8/rank/home/1-${RANK_ID}-${volid}.html`;
  try {
    const response = await fetch(url, { redirect:'follow', headers, signal:AbortSignal.timeout(8000) });
    const text = await response.text();
    return { volid, status:response.status, final_url:response.url, length:text.length, ...inspect(text) };
  } catch (error) {
    return { volid, error:String(error?.message || error) };
  }
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({length:Math.min(limit,items.length)}, worker));
  return out;
}

const ids = Array.from({length:END-START+1}, (_,i)=>START+i);
const results = await mapLimit(ids, CONCURRENCY, probe);
const historical = results.filter(x => x.status === 200 && x.feature_count === 30 && x.date && x.date < '2021-01-01');
const exact2020 = historical.filter(x => String(x.date).startsWith('2020'));
const unique = [...new Map(historical.map(x => [`${x.date}|${x.volid}`,x])).values()].sort((a,b)=>String(a.date).localeCompare(String(b.date)) || a.volid-b.volid);

console.log(JSON.stringify({
  observed_at:new Date().toISOString(),
  rank_id:RANK_ID,
  scanned:{start:START,end:END,count:ids.length,concurrency:CONCURRENCY},
  errors:results.filter(x=>x.error).length,
  historical_count:historical.length,
  exact_2020_count:exact2020.length,
  earliest:unique[0] || null,
  latest:unique.at(-1) || null,
  historical:unique,
}, null, 2));
