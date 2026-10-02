import crypto from 'node:crypto';
import fs from 'node:fs';

const APPID = 1005;
const CLIENTVER = 20489;
const SALT = 'OIlwieks28dk2k092lksi2UIkp';
const RANK_ID = 31312;
const GUID = '8d6d3bb0-7c71-4acd-a6e4-9ebf8ec1d842';
const CONCURRENCY = 4;
const RETRIES = 2;

const aliases = {
  sakurazaka46: ['櫻坂46', '桜坂46', 'Sakurazaka46', '樱坂46'],
  hinatazaka46: ['日向坂46', 'Hinatazaka46'],
  nogizaka46: ['乃木坂46', 'Nogizaka46'],
};

function md5(value) {
  return crypto.createHash('md5').update(value).digest('hex');
}

function calculateMid(guid) {
  return BigInt(`0x${md5(guid)}`).toString(10);
}

function sign(params, data = '') {
  const paramsString = Object.keys(params)
    .sort()
    .map((key) => `${key}=${typeof params[key] === 'object' ? JSON.stringify(params[key]) : params[key]}`)
    .join('');
  return md5(`${SALT}${paramsString}${data}${SALT}`);
}

function normalize(value) {
  return String(value || '').normalize('NFKC').toLocaleLowerCase('en-US').replace(/\s+/g, '');
}

function groupFor(entry) {
  const authorNames = Array.isArray(entry?.authors)
    ? entry.authors.map((author) => author?.author_name || author?.name).filter(Boolean)
    : [];
  const haystack = normalize([
    entry?.author_name,
    entry?.singername,
    entry?.singer_name,
    ...authorNames,
    entry?.filename,
    entry?.business?.filename,
    entry?.songname,
    entry?.song_name,
  ].filter(Boolean).join(' '));
  for (const [group, names] of Object.entries(aliases)) {
    if (names.some((name) => haystack.includes(normalize(name)))) return group;
  }
  return null;
}

function commonParams(extra = {}) {
  const mid = calculateMid(GUID);
  const params = {
    dfid: '-',
    mid,
    uuid: '-',
    appid: APPID,
    clientver: CLIENTVER,
    clienttime: Math.floor(Date.now() / 1000),
    ...extra,
  };
  return { params, mid };
}

function headers(mid, clienttime, extra = {}) {
  return {
    accept: 'application/json,text/plain,*/*',
    'user-agent': 'Android15-1070-11083-46-0-DiscoveryDRADProtocol-wifi',
    dfid: '-',
    mid,
    clienttime: String(clienttime),
    'kg-rc': '1',
    'kg-thash': '5d816a0',
    'kg-rec': '1',
    'kg-rf': 'B9EDA08A64250DEFFBCADDEE00F8F25F',
    ...extra,
  };
}

async function fetchJson(url, options = {}, retries = RETRIES) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, options);
      const text = await response.text();
      let json;
      try { json = JSON.parse(text); } catch { throw new Error(`non-json HTTP ${response.status}: ${text.slice(0, 200)}`); }
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
      return { response, json };
    } catch (error) {
      lastError = error;
      if (attempt < retries) await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
    }
  }
  throw lastError;
}

async function fetchVolumes() {
  const { params, mid } = commonParams({
    rank_cid: 0,
    rankid: RANK_ID,
    ranktype: 1,
    type: 0,
    plat: 2,
  });
  params.signature = sign(params);
  const query = new URLSearchParams(Object.entries(params).map(([key, value]) => [key, String(value)])).toString();
  const { response, json } = await fetchJson(`https://gateway.kugou.com/ocean/v6/rank/vol?${query}`, {
    method: 'GET',
    headers: headers(mid, params.clienttime),
  });
  if (json?.status !== 1 || (json?.error_code && json.error_code !== 0)) {
    throw new Error(`rank/vol API failure: ${JSON.stringify(json).slice(0, 1000)}`);
  }

  const volumes = [];
  const seen = new Set();
  const push = (vol, year = null) => {
    const volid = Number(vol?.volid ?? vol?.rank_cid ?? vol?.cid);
    if (!Number.isFinite(volid) || seen.has(volid)) return;
    seen.add(volid);
    volumes.push({
      volid,
      year: year ?? vol?.year ?? null,
      volname: vol?.volname ?? vol?.name ?? null,
      voltitle: vol?.voltitle ?? vol?.title ?? null,
      raw: vol,
    });
  };
  const walk = (value, year = null, depth = 0) => {
    if (depth > 8 || value == null) return;
    if (Array.isArray(value)) {
      for (const item of value) walk(item, year, depth + 1);
      return;
    }
    if (typeof value !== 'object') return;
    const nextYear = value.year ?? year;
    if (value.volid != null || value.rank_cid != null || value.cid != null) push(value, nextYear);
    for (const child of Object.values(value)) walk(child, nextYear, depth + 1);
  };
  walk(json?.data ?? json);
  return {
    http_status: response.status,
    api_status: json?.status ?? null,
    error_code: json?.error_code ?? json?.errcode ?? null,
    total_found: volumes.length,
    top_keys: Object.keys(json || {}),
    data_keys: json?.data && typeof json.data === 'object' ? Object.keys(json.data) : [],
    volumes,
  };
}

async function fetchVolume(volume) {
  const bodyObject = {
    show_portrait_mv: 1,
    show_type_total: 1,
    filter_original_remarks: 1,
    area_code: 1,
    pagesize: 100,
    rank_cid: volume.volid,
    type: 1,
    page: 1,
    rank_id: RANK_ID,
  };
  const body = JSON.stringify(bodyObject);
  const { params, mid } = commonParams();
  params.signature = sign(params, body);
  const query = new URLSearchParams(Object.entries(params).map(([key, value]) => [key, String(value)])).toString();
  const { response, json } = await fetchJson(`https://gateway.kugou.com/openapi/kmr/v2/rank/audio?${query}`, {
    method: 'POST',
    headers: headers(mid, params.clienttime, { 'content-type': 'application/json', 'kg-tid': '369' }),
    body,
  });
  const entries = Array.isArray(json?.data?.songlist) ? json.data.songlist : [];
  if (json?.status !== 1 || (json?.error_code && json.error_code !== 0)) {
    throw new Error(`rank/audio API failure volid=${volume.volid}: ${JSON.stringify(json).slice(0, 700)}`);
  }
  const publishDates = [...new Set(entries.map((entry) => entry?.business?.rank_id_publish_date).filter(Boolean))];
  const issues = [...new Set(entries.map((entry) => entry?.business?.issue).filter((value) => value != null))];
  const matches = [];
  entries.forEach((entry, index) => {
    const group = groupFor(entry);
    if (!group) return;
    matches.push({
      group,
      date: entry?.business?.rank_id_publish_date ?? null,
      issue: entry?.business?.issue ?? null,
      volid: volume.volid,
      rank: entry?.business?.sort ?? index + 1,
      previous_rank: entry?.business?.last_sort ?? null,
      rank_count: entry?.business?.rank_count ?? null,
      author_name: entry?.author_name ?? null,
      songname: entry?.songname ?? null,
      album_name: entry?.album_info?.album_name ?? null,
      album_audio_id: entry?.album_audio_id ?? null,
      audio_id: entry?.audio_id ?? null,
    });
  });
  return {
    volid: volume.volid,
    year: volume.year,
    volname: volume.volname,
    voltitle: volume.voltitle,
    http_status: response.status,
    entry_count: entries.length,
    publish_dates: publishDates,
    issues,
    matches,
  };
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      try {
        results[index] = { ok: true, value: await fn(items[index], index) };
      } catch (error) {
        results[index] = { ok: false, error: String(error?.stack || error), item: items[index] };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

function csvEscape(value) {
  if (value == null) return '';
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

const observedAt = new Date().toISOString();
const volumeIndex = await fetchVolumes();
const crawl = await mapLimit(volumeIndex.volumes, CONCURRENCY, fetchVolume);
const successful = crawl.filter((row) => row.ok).map((row) => row.value);
const failed = crawl.filter((row) => !row.ok).map((row) => ({ volid: row.item?.volid, year: row.item?.year, error: row.error }));
const matches = successful.flatMap((row) => row.matches);

const allDates = successful.flatMap((row) => row.publish_dates).filter(Boolean).sort();
const matchDates = matches.map((row) => row.date).filter(Boolean).sort();
const groupCounts = Object.fromEntries(Object.keys(aliases).map((group) => [group, matches.filter((row) => row.group === group).length]));
const matchedIssues = Object.fromEntries(Object.keys(aliases).map((group) => [group, new Set(matches.filter((row) => row.group === group).map((row) => `${row.date}|${row.issue}`)).size]));

const out = {
  observed_at: observedAt,
  rank_id: RANK_ID,
  volume_index: {
    total: volumeIndex.total_found,
    years: [...new Set(volumeIndex.volumes.map((row) => row.year).filter((value) => value != null))].sort((a, b) => Number(a) - Number(b)),
    min_volid: volumeIndex.volumes.length ? Math.min(...volumeIndex.volumes.map((row) => row.volid)) : null,
    max_volid: volumeIndex.volumes.length ? Math.max(...volumeIndex.volumes.map((row) => row.volid)) : null,
  },
  crawl: {
    requested: volumeIndex.volumes.length,
    succeeded: successful.length,
    failed: failed.length,
    earliest_successful_publish_date: allDates[0] ?? null,
    latest_successful_publish_date: allDates.at(-1) ?? null,
    earliest_match_date: matchDates[0] ?? null,
    latest_match_date: matchDates.at(-1) ?? null,
    failures: failed,
  },
  group_match_rows: groupCounts,
  group_matched_issues: matchedIssues,
  matches: matches.sort((a, b) => String(a.date).localeCompare(String(b.date)) || Number(a.rank) - Number(b.rank)),
  volumes: successful.map(({ matches: _matches, ...row }) => ({ ...row, match_count: _matches.length })),
};

fs.writeFileSync('kugou-japan-history.json', `${JSON.stringify(out, null, 2)}\n`);
const columns = ['date','issue','volid','group','rank','previous_rank','rank_count','author_name','songname','album_name','album_audio_id','audio_id'];
const csv = [columns.join(','), ...out.matches.map((row) => columns.map((column) => csvEscape(row[column])).join(','))].join('\n') + '\n';
fs.writeFileSync('kugou-japan-history.csv', csv);

console.log(JSON.stringify({
  observed_at: out.observed_at,
  rank_id: out.rank_id,
  volume_index: out.volume_index,
  crawl: out.crawl,
  group_match_rows: out.group_match_rows,
  group_matched_issues: out.group_matched_issues,
  match_preview_first: out.matches.slice(0, 20),
  match_preview_last: out.matches.slice(-20),
}, null, 2));
