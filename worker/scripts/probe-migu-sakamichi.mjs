import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const OUT_DIR = new URL('../migu-sakamichi-evidence/', import.meta.url);
const SEARCH_URL = 'https://app.c.nf.migu.cn/MIGUM2.0/v1.0/content/search_all.do';
const RANK_INDEX_URL = 'https://app.c.nf.migu.cn/pc/bmw/rank/rank-index/v1.0';
const RANK_INFO_URL = 'https://app.c.nf.migu.cn/bmw/rank/rank-info/v1.0';
const OPNUM_URL = 'https://app.c.nf.migu.cn/opnum/query-optype-v1.0';

const MG_DEVICE_ID = '963B7AA0D21511ED807EE5846EC87D20';
const MG_SIGN_KEY = '6cdc72a439cef99a3418d2a78aa28c73';

const TARGETS = [
  { key: 'sakurazaka46', queries: ['櫻坂46', '樱坂46', 'Sakurazaka46', 'Sakurazaka 46'] },
  { key: 'nogizaka46', queries: ['乃木坂46', 'Nogizaka46', 'Nogizaka 46'] },
  { key: 'hinatazaka46', queries: ['日向坂46', 'Hinatazaka46', 'Hinatazaka 46'] },
  { key: 'sakamichi_selection', queries: ['坂道選抜', '坂道选拔', 'Sakamichi Selection'] },
];

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const md5 = (text) => createHash('md5').update(text).digest('hex');
const normalize = (value) => String(value ?? '')
  .normalize('NFKC')
  .toLowerCase()
  .replace(/[\s\u3000·・._\-—–()（）\[\]【】]/g, '');

function mgSign(timestamp, keyword) {
  return md5(`${keyword}${MG_SIGN_KEY}yyapp2d16148780a1dcc7408e06336b98cfd50${MG_DEVICE_ID}${timestamp}`);
}

async function fetchJson(url, init = {}, label = url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error(`timeout: ${label}`)), 20_000);
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        accept: 'application/json,text/plain,*/*',
        'accept-language': 'zh-CN,zh;q=0.9,en;q=0.7',
        'user-agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/131.0 Mobile Safari/537.36',
        ...(init.headers || {}),
      },
    });
    const text = await response.text();
    let body;
    try { body = JSON.parse(text); }
    catch { body = { _non_json: text.slice(0, 20_000) }; }
    return { ok: response.ok, status: response.status, body };
  } finally {
    clearTimeout(timeout);
  }
}

function flattenObjects(value, out = [], path = '$') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => flattenObjects(item, out, `${path}[${index}]`));
    return out;
  }
  if (!value || typeof value !== 'object') return out;
  out.push({ path, value });
  for (const [key, item] of Object.entries(value)) flattenObjects(item, out, `${path}.${key}`);
  return out;
}

function firstValue(obj, keys) {
  for (const key of keys) {
    const value = obj?.[key];
    if (value !== undefined && value !== null && String(value) !== '') return value;
  }
  return null;
}

function singerNames(obj) {
  const values = [];
  for (const key of ['singers', 'singer', 'artists', 'artist', 'singerList', 'artistList']) {
    const raw = obj?.[key];
    if (Array.isArray(raw)) {
      for (const item of raw) {
        if (typeof item === 'string') values.push(item);
        else if (item && typeof item === 'object') values.push(firstValue(item, ['name', 'singerName', 'artistName']) || '');
      }
    } else if (typeof raw === 'string') values.push(raw);
    else if (raw && typeof raw === 'object') values.push(firstValue(raw, ['name', 'singerName', 'artistName']) || '');
  }
  for (const key of ['singerName', 'artistName', 'authorName']) if (obj?.[key]) values.push(obj[key]);
  return [...new Set(values.map(String).map(v => v.trim()).filter(Boolean))];
}

function summarizeObjects(payload, targetAliases = []) {
  const aliasSet = targetAliases.map(normalize).filter(Boolean);
  const rows = [];
  for (const { path, value } of flattenObjects(payload)) {
    const title = firstValue(value, ['name', 'songName', 'title', 'musicName', 'trackName']);
    const singers = singerNames(value);
    const combined = [title, ...singers].map(normalize);
    const matched = aliasSet.length > 0 && combined.some(text => aliasSet.some(alias => text.includes(alias) || alias.includes(text)));
    const ids = {
      contentId: firstValue(value, ['contentId', 'contentID']),
      copyrightId: firstValue(value, ['copyrightId', 'copyrightID']),
      resourceId: firstValue(value, ['resourceId', 'resourceID', 'id']),
      songId: firstValue(value, ['songId', 'musicId']),
      singerId: firstValue(value, ['singerId', 'artistId']),
      mvId: firstValue(value, ['mvId', 'mvContentId', 'videoId']),
    };
    const metrics = {};
    for (const key of [
      'listenCount','playCount','listen_cnt','playNum','playCountDesc','opNum','hotValue',
      'chartScore','score','rank','rankNo','position','mvPlayCount','videoPlayCount','commentCount',
      'collectCount','favoriteCount','shareCount',
    ]) if (value?.[key] !== undefined) metrics[key] = value[key];
    if (matched || title || singers.length || Object.values(ids).some(Boolean) || Object.keys(metrics).length) {
      rows.push({ path, matched, title: title || null, singers, ids, metrics });
    }
  }
  return rows;
}

function collectRankIds(payload) {
  const output = new Map();
  for (const { path, value } of flattenObjects(payload)) {
    const rankId = firstValue(value, ['rankId', 'rankID', 'rankid', 'id']);
    const rankName = firstValue(value, ['rankName', 'name', 'title', 'rankTitle']);
    if (!rankId || !rankName) continue;
    const text = String(rankName);
    if (!/榜|rank|top|chart/i.test(text)) continue;
    output.set(String(rankId), { rankId: String(rankId), rankName: text, path });
  }
  return [...output.values()];
}

async function searchMigu(keyword, pageNo = 1) {
  const timestamp = Date.now();
  const params = new URLSearchParams({
    ua: 'Android_migu',
    version: '5.0.1',
    text: keyword,
    pageNo: String(pageNo),
    pageSize: '20',
    searchSwitch: JSON.stringify({
      song: 1, album: 1, singer: 1, tagSong: 1, mvSong: 1, songlist: 1, bestShow: 1, lyricSong: 0,
    }),
    isCopyright: '1',
    isCorrect: '1',
    sort: '0',
  });
  return fetchJson(`${SEARCH_URL}?${params}`, {
    headers: {
      sign: mgSign(timestamp, keyword),
      timestamp: String(timestamp),
      appId: 'yyapp2',
      mode: 'android',
      ua: 'Android_migu',
      version: '6.9.4',
      osVersion: 'android 7.0',
      deviceId: MG_DEVICE_ID,
    },
  }, `search:${keyword}`);
}

async function writeJson(name, value) {
  await writeFile(join(OUT_DIR.pathname, name), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

await mkdir(OUT_DIR, { recursive: true });

const summary = {
  generated_at: new Date().toISOString(),
  endpoints: { SEARCH_URL, RANK_INDEX_URL, RANK_INFO_URL, OPNUM_URL },
  searches: {},
  rank_index: null,
  ranks: [],
  opnum: [],
};

const opnumIds = new Set();
for (const target of TARGETS) {
  const targetSummary = [];
  for (const keyword of target.queries) {
    try {
      const response = await searchMigu(keyword);
      const safeName = `${target.key}-${Buffer.from(keyword).toString('hex')}.json`;
      await writeJson(`search-${safeName}`, response);
      const objects = summarizeObjects(response.body, target.queries);
      for (const row of objects) {
        for (const id of [row.ids.resourceId, row.ids.songId, row.ids.contentId]) {
          if (id && /^\d+$/.test(String(id))) opnumIds.add(String(id));
        }
      }
      targetSummary.push({
        keyword,
        http_status: response.status,
        ok: response.ok,
        song_total: response.body?.songResultData?.totalCount ?? null,
        singer_total: response.body?.singerResultData?.totalCount ?? null,
        album_total: response.body?.albumResultData?.totalCount ?? null,
        mv_total: response.body?.mvResultData?.totalCount ?? null,
        matched_objects: objects.filter(row => row.matched).slice(0, 100),
        metric_objects: objects.filter(row => Object.keys(row.metrics).length).slice(0, 100),
      });
    } catch (error) {
      targetSummary.push({ keyword, ok: false, error: String(error?.stack || error) });
    }
    await wait(350);
  }
  summary.searches[target.key] = targetSummary;
}

try {
  const rankIndex = await fetchJson(RANK_INDEX_URL, {}, 'rank-index');
  await writeJson('rank-index.json', rankIndex);
  const ranks = collectRankIds(rankIndex.body);
  summary.rank_index = { ok: rankIndex.ok, http_status: rankIndex.status, rank_count: ranks.length, ranks };

  for (const rank of ranks.slice(0, 100)) {
    try {
      const response = await fetchJson(`${RANK_INFO_URL}?${new URLSearchParams({ pageNo: '1', rankId: rank.rankId })}`, {}, `rank:${rank.rankId}`);
      await writeJson(`rank-${rank.rankId}.json`, response);
      const aliases = TARGETS.flatMap(target => target.queries);
      const objects = summarizeObjects(response.body, aliases);
      const matches = objects.filter(row => row.matched);
      if (matches.length) {
        for (const row of matches) {
          for (const id of [row.ids.resourceId, row.ids.songId, row.ids.contentId]) {
            if (id && /^\d+$/.test(String(id))) opnumIds.add(String(id));
          }
        }
      }
      summary.ranks.push({
        ...rank,
        http_status: response.status,
        ok: response.ok,
        sakamichi_matches: matches.slice(0, 100),
        metric_objects: objects.filter(row => Object.keys(row.metrics).length).slice(0, 50),
      });
    } catch (error) {
      summary.ranks.push({ ...rank, ok: false, error: String(error?.stack || error) });
    }
    await wait(250);
  }
} catch (error) {
  summary.rank_index = { ok: false, error: String(error?.stack || error) };
}

const probeIds = [...opnumIds].slice(0, 30);
for (const resourceType of ['2', '2021', 'D', 'M']) {
  if (!probeIds.length) break;
  const params = new URLSearchParams({ opType: 'play', resourceType, ids: probeIds.join(',') });
  try {
    const response = await fetchJson(`${OPNUM_URL}?${params}`, {}, `opnum:${resourceType}`);
    await writeJson(`opnum-resourceType-${resourceType}.json`, response);
    summary.opnum.push({ resourceType, ids: probeIds, http_status: response.status, ok: response.ok, body: response.body });
  } catch (error) {
    summary.opnum.push({ resourceType, ids: probeIds, ok: false, error: String(error?.stack || error) });
  }
  await wait(250);
}

await writeJson('summary.json', summary);

const compact = {
  generated_at: summary.generated_at,
  search_status: Object.fromEntries(Object.entries(summary.searches).map(([key, rows]) => [key, rows.map(row => ({
    keyword: row.keyword,
    ok: row.ok,
    http_status: row.http_status,
    song_total: row.song_total,
    singer_total: row.singer_total,
    album_total: row.album_total,
    mv_total: row.mv_total,
    matches: row.matched_objects?.length || 0,
  }))])),
  rank_index: summary.rank_index && {
    ok: summary.rank_index.ok,
    http_status: summary.rank_index.http_status,
    rank_count: summary.rank_index.rank_count,
  },
  sakamichi_rank_hits: summary.ranks
    .filter(row => row.sakamichi_matches?.length)
    .map(row => ({ rankId: row.rankId, rankName: row.rankName, hits: row.sakamichi_matches.length })),
  opnum: summary.opnum.map(row => ({ resourceType: row.resourceType, ok: row.ok, http_status: row.http_status })),
};
console.log(JSON.stringify(compact, null, 2));
