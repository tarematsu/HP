import crypto from 'node:crypto';
import fs from 'node:fs';

const APPID = 1005;
const CLIENTVER = 20489;
const SALT = 'OIlwieks28dk2k092lksi2UIkp';
const GUID = '8d6d3bb0-7c71-4acd-a6e4-9ebf8ec1d842';
const RANK_ID = 31312;
const PAGES = [1, 2, 3, 4];
const CONCURRENCY = 6;
const RETRIES = 1;
const CUTOFF = '2024-10-31';

const aliases = {
  sakurazaka46: ['櫻坂46','桜坂46','Sakurazaka46','樱坂46'],
  hinatazaka46: ['日向坂46','Hinatazaka46'],
  nogizaka46: ['乃木坂46','Nogizaka46'],
};

const md5 = (value) => crypto.createHash('md5').update(value).digest('hex');
const normalize = (value) => String(value || '').normalize('NFKC').toLocaleLowerCase('en-US').replace(/\s+/g, '');
function sign(params) {
  const paramsString = Object.keys(params).sort().map((key) => `${key}=${params[key]}`).join('');
  return md5(`${SALT}${paramsString}${SALT}`);
}
function groupFor(entry) {
  const haystack = normalize([entry?.singername, entry?.author_name, entry?.filename, entry?.songname].filter(Boolean).join(' '));
  for (const [group, names] of Object.entries(aliases)) if (names.some((name) => haystack.includes(normalize(name)))) return group;
  return null;
}
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
function parseFeatures(text) {
  const raw = extractJsonArrayAfter(text, 'global.features');
  if (!raw) throw new Error('global.features not found');
  return JSON.parse(raw);
}
function singerFor(entry) {
  const singer = String(entry?.singername || '').trim();
  if (singer) return singer;
  const filename = String(entry?.filename || '').trim();
  const split = filename.indexOf(' - ');
  return split >= 0 ? filename.slice(0, split) : '';
}
function titleFor(entry) {
  const song = String(entry?.songname || '').trim();
  if (song) return song;
  const filename = String(entry?.filename || '').trim();
  const singer = singerFor(entry);
  return singer && filename.startsWith(`${singer} - `) ? filename.slice(singer.length + 3) : filename;
}
async function fetchWithRetry(url, options = {}, retries = RETRIES) {
  let last;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, options);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response;
    } catch (error) {
      last = error;
      if (attempt < retries) await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
    }
  }
  throw last;
}
async function fetchVolumes() {
  const clienttime = Math.floor(Date.now() / 1000);
  const mid = BigInt(`0x${md5(GUID)}`).toString(10);
  const params = { dfid:'-', mid, uuid:'-', appid:APPID, clientver:CLIENTVER, clienttime, rank_cid:0, rankid:RANK_ID, ranktype:1, type:0, plat:2 };
  params.signature = sign(params);
  const query = new URLSearchParams(Object.entries(params).map(([k,v]) => [k,String(v)])).toString();
  const response = await fetchWithRetry(`https://gateway.kugou.com/ocean/v6/rank/vol?${query}`, { headers:{ accept:'application/json,text/plain,*/*', 'user-agent':'Android15-1070-11083-46-0-DiscoveryDRADProtocol-wifi', dfid:'-', mid, clienttime:String(clienttime), 'kg-rc':'1', 'kg-thash':'5d816a0', 'kg-rec':'1', 'kg-rf':'B9EDA08A64250DEFFBCADDEE00F8F25F' } });
  const json = await response.json();
  const rows = [], seen = new Set();
  function walk(value, year = null, depth = 0) {
    if (depth > 8 || value == null) return;
    if (Array.isArray(value)) { for (const item of value) walk(item, year, depth + 1); return; }
    if (typeof value !== 'object') return;
    const nextYear = value.year ?? year;
    const volid = Number(value.volid ?? value.rank_cid ?? value.cid);
    if (Number.isFinite(volid) && !seen.has(volid)) {
      seen.add(volid);
      rows.push({ volid, year: nextYear == null ? null : Number(nextYear), volname:value.volname ?? value.name ?? null, voltitle:value.voltitle ?? value.title ?? null });
    }
    for (const child of Object.values(value)) walk(child, nextYear, depth + 1);
  }
  walk(json?.data ?? json);
  return rows;
}
async function fetchPage(vol, page) {
  const url = `https://pc.service.kugou.com/yueku/v8/rank/home/${page}-${RANK_ID}-${vol.volid}.html`;
  const response = await fetchWithRetry(url, { headers:{ 'user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36', accept:'text/html,application/xhtml+xml' } });
  const text = await response.text();
  const date = text.match(/(20\d{2})[-\/.年](\d{1,2})[-\/.月](\d{1,2})/)?.[0]?.replace(/[年/.]/g,'-').replace('月','-').replace('日','') || null;
  const entries = parseFeatures(text);
  return { page, date, entries, url };
}
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      try { results[index] = { ok:true, value:await fn(items[index]) }; }
      catch (error) { results[index] = { ok:false, item:items[index], error:String(error?.stack || error) }; }
    }
  }
  await Promise.all(Array.from({ length:Math.min(limit, items.length) }, () => worker()));
  return results;
}
const csvEscape = (value) => value == null ? '' : /[",\n]/.test(String(value)) ? `"${String(value).replaceAll('"','""')}"` : String(value);

const observedAt = new Date().toISOString();
const volumes = await fetchVolumes();
const candidates = volumes.filter((row) => row.year == null || row.year <= 2024);
const tasks = candidates.flatMap((vol) => PAGES.map((page) => ({ vol, page })));
const fetched = await mapLimit(tasks, CONCURRENCY, ({ vol, page }) => fetchPage(vol, page).then((result) => ({ vol, ...result })));
const successes = fetched.filter((row) => row.ok).map((row) => row.value);
const failures = fetched.filter((row) => !row.ok).map((row) => ({ volid:row.item.vol.volid, year:row.item.vol.year, page:row.item.page, error:row.error }));

const perVol = new Map();
for (const page of successes) {
  if (!perVol.has(page.vol.volid)) perVol.set(page.vol.volid, { vol:page.vol, pages:[] });
  perVol.get(page.vol.volid).pages.push(page);
}
const matches = [];
const issues = [];
for (const { vol, pages } of perVol.values()) {
  pages.sort((a,b) => a.page - b.page);
  const date = pages.find((p) => p.date)?.date || null;
  const featureCount = pages.reduce((sum,p) => sum + p.entries.length, 0);
  const complete = pages.length === 4 && featureCount === 100;
  issues.push({ volid:vol.volid, year:vol.year, date, page_count:pages.length, feature_count:featureCount, complete });
  if (!date || date >= CUTOFF) continue;
  for (const page of pages) for (let i = 0; i < page.entries.length; i += 1) {
    const entry = page.entries[i];
    const group = groupFor(entry);
    if (!group) continue;
    matches.push({ date, volid:vol.volid, group, rank:(page.page - 1) * 30 + i + 1, singer:singerFor(entry), title:titleFor(entry), album_id:entry?.album_id ?? null, album_audio_id:entry?.album_audio_id ?? null, audio_id:entry?.audio_id ?? entry?.scid ?? null, hash:entry?.hash ?? entry?.HASH ?? null, last_day_rank:entry?.last_day_rank ?? null, source:'kugou_legacy_web' });
  }
}
matches.sort((a,b) => a.date.localeCompare(b.date) || a.rank - b.rank || a.group.localeCompare(b.group));
issues.sort((a,b) => String(a.date).localeCompare(String(b.date)) || a.volid - b.volid);
const dates = issues.map((row) => row.date).filter(Boolean).filter((date) => date < CUTOFF).sort();
const counts = Object.fromEntries(Object.keys(aliases).map((group) => [group, matches.filter((row) => row.group === group).length]));
const issueCounts = Object.fromEntries(Object.keys(aliases).map((group) => [group, new Set(matches.filter((row) => row.group === group).map((row) => `${row.date}|${row.volid}`)).size]));
const summary = { observed_at:observedAt, rank_id:RANK_ID, volume_index_total:volumes.length, candidate_volumes:candidates.length, page_requests:tasks.length, successful_pages:successes.length, failed_pages:failures.length, complete_issues:issues.filter((row) => row.complete).length, earliest_recovered_date:dates[0] ?? null, latest_recovered_date:dates.at(-1) ?? null, matches:matches.length, group_match_rows:counts, group_matched_issues:issueCounts, failures };
fs.writeFileSync('kugou-web-history-backfill.json', `${JSON.stringify({ summary, issues, matches }, null, 2)}\n`);
const columns = ['date','volid','group','rank','singer','title','album_id','album_audio_id','audio_id','hash','last_day_rank','source'];
fs.writeFileSync('kugou-web-history-backfill.csv', [columns.join(','), ...matches.map((row) => columns.map((column) => csvEscape(row[column])).join(','))].join('\n') + '\n');
console.log(JSON.stringify({ ...summary, first_matches:matches.slice(0,20), last_matches:matches.slice(-20) }, null, 2));
