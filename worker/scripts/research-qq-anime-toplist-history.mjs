import { mkdir, writeFile } from 'node:fs/promises';
import { parseQqJapanToplist } from '../src/regional-music-qq.js';

const TOP_ID = 72;
const LIMIT = 100;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_START = '2018-01-01';
const REQUEST_DELAY_MS = 250;
const OUTPUT = process.env.QQ_ANIME_OUTPUT || 'artifacts/qq-anime-toplist-history.json';

const TITLE_TARGETS = [
  'ピッカーン',
  '月の大きさ',
  '指望遠鏡',
  'ここじゃないどこか',
  '今、話したい誰かがいる',
  '空扉',
  'あの光',
  '1・2・3',
  '１・２・３',
  'ロマンティックがほしいなら',
  'whatskazoku',
];

const ARTIST_TARGETS = [
  '乃木坂46', 'nogizaka46',
  '櫻坂46', 'sakurazaka46',
  '日向坂46', 'hinatazaka46',
  '欅坂46', 'keyakizaka46',
  'けやき坂46',
  'からあげ姉妹',
  '生田絵梨花', '松村沙友理',
  '松田里奈', '森田ひかる',
  '小坂菜緒', '正源司陽子', '藤嶌果歩',
];

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function normalize(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[\s\p{P}\p{S}]+/gu, '');
}

function isoWeekPeriod(dateLike) {
  const input = dateLike instanceof Date ? dateLike : new Date(dateLike);
  const date = new Date(Date.UTC(input.getUTCFullYear(), input.getUTCMonth(), input.getUTCDate()));
  const weekday = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - weekday + 3);
  const isoYear = date.getUTCFullYear();
  const jan4 = new Date(Date.UTC(isoYear, 0, 4));
  const jan4Weekday = (jan4.getUTCDay() + 6) % 7;
  jan4.setUTCDate(jan4.getUTCDate() - jan4Weekday + 3);
  const week = 1 + Math.round((date.getTime() - jan4.getTime()) / WEEK_MS);
  return `${isoYear}_${week}`;
}

function latestThursdayJst(now = Date.now()) {
  const jst = new Date(Number(now) + 9 * 60 * 60 * 1000);
  const calendar = new Date(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate()));
  const daysBack = (calendar.getUTCDay() - 4 + 7) % 7;
  calendar.setUTCDate(calendar.getUTCDate() - daysBack);
  return calendar;
}

function periods(now = Date.now(), startDate = DEFAULT_START) {
  const earliest = new Date(`${startDate}T00:00:00Z`);
  const output = [];
  const seen = new Set();
  for (let date = latestThursdayJst(now); date >= earliest; date = new Date(date.getTime() - WEEK_MS)) {
    const period = isoWeekPeriod(date);
    if (!seen.has(period)) {
      seen.add(period);
      output.push(period);
    }
  }
  return output;
}

function toplistUrl(period) {
  const data = { comm:{ ct:24, cv:0 }, req_1:{
    module:'musicToplist.ToplistInfoServer',
    method:'GetDetail',
    param:{ topId:TOP_ID, offset:0, num:LIMIT, period },
  } };
  return `https://u.y.qq.com/cgi-bin/musicu.fcg?${new URLSearchParams({g_tk:'5381', format:'json', data:JSON.stringify(data)})}`;
}

function providerPeriod(payload) {
  const data = payload?.req_1?.data || payload?.detail?.data || payload?.data || {};
  return data?.period || data?.periodName || data?.period_name || data?.periodDetail || null;
}

function fingerprint(entries) {
  return entries.map((row) => `${row.position}:${row.track_id}`).join('|');
}

async function fetchPeriod(period) {
  const response = await fetch(toplistUrl(period), {
    headers:{
      accept:'application/json,text/plain,*/*',
      referer:`https://y.qq.com/n/ryqq/toplist/${TOP_ID}`,
      'user-agent':'Mozilla/5.0 compatible; skrzk-pages-qq-anime-research/1.0',
    },
    signal:AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = JSON.parse(await response.text());
  if (payload?.code || payload?.req_1?.code) throw new Error('provider error');
  const chart = parseQqJapanToplist(payload);
  return { ...chart, provider_period:providerPeriod(payload), fingerprint:fingerprint(chart.entries) };
}

function isTarget(entry) {
  const title = normalize(entry.title);
  const artists = normalize((entry.artists || []).map((artist) => artist.name).join(' '));
  return TITLE_TARGETS.some((target) => title.includes(normalize(target)))
    || ARTIST_TARGETS.some((target) => artists.includes(normalize(target)))
    || Boolean(entry.canonical_artist);
}

async function main() {
  const start = process.env.QQ_ANIME_HISTORY_START || DEFAULT_START;
  const requested = periods(Date.now(), start);
  const weeks = [];
  const hits = [];
  const errors = [];
  let previousFingerprint = null;
  let repeated = 0;

  for (const period of requested) {
    try {
      const chart = await fetchPeriod(period);
      if (!chart.entries.length) {
        errors.push({ period, error:'empty chart' });
        continue;
      }
      if (chart.fingerprint === previousFingerprint) repeated += 1;
      else repeated = 0;
      previousFingerprint = chart.fingerprint;
      if (repeated >= 4) {
        errors.push({ period, error:'provider appears to ignore older period; stopping' });
        break;
      }

      const rows = chart.entries.map((entry) => ({
        period,
        provider_period:chart.provider_period ?? null,
        update_time:chart.update_time ?? null,
        rank:entry.position,
        track_id:entry.track_id,
        title:entry.title,
        album_name:entry.album_name,
        canonical_artist:entry.canonical_artist ?? null,
        artists:(entry.artists || []).map((artist) => artist.name).filter(Boolean),
      }));
      weeks.push({ period, provider_period:chart.provider_period ?? null, update_time:chart.update_time ?? null, rows });
      hits.push(...rows.filter(isTarget));
      console.log(JSON.stringify({ event:'qq_anime_period', period, provider_period:chart.provider_period ?? null, rows:rows.length, hits:rows.filter(isTarget).length }));
    } catch (error) {
      errors.push({ period, error:String(error?.message || error) });
    }
    await sleep(REQUEST_DELAY_MS);
  }

  const dedupedHits = [...new Map(hits.map((row) => [`${row.period}:${row.track_id}`, row])).values()];
  const result = {
    version:1,
    chart:'动漫音乐榜',
    top_id:TOP_ID,
    generated_at:new Date().toISOString(),
    requested_periods:requested.length,
    stored_periods:weeks.length,
    earliest_period:weeks.at(-1)?.period ?? null,
    latest_period:weeks[0]?.period ?? null,
    target_titles:TITLE_TARGETS,
    target_artists:ARTIST_TARGETS,
    hits:dedupedHits,
    errors,
    weeks,
  };
  await mkdir(OUTPUT.split('/').slice(0, -1).join('/') || '.', { recursive:true });
  await writeFile(OUTPUT, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({ event:'qq_anime_complete', stored_periods:weeks.length, hits:dedupedHits.length, errors:errors.length, output:OUTPUT }));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
