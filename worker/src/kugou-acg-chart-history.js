import { REGIONAL_MUSIC_ARTISTS } from './regional-music-service-registry.js';

export const KUGOU_ACG_RANK_ID = 33162;
export const KUGOU_ACG_HISTORY_PREFIX = 'regional-music/kugou_music/acg-new-chart-history';
export const KUGOU_ACG_HISTORY_INDEX_KEY = `${KUGOU_ACG_HISTORY_PREFIX}/index.json`;
export const KUGOU_ACG_HISTORY_VIEW_KEY = `${KUGOU_ACG_HISTORY_PREFIX}/view.json`;
export const KUGOU_ACG_HISTORY_PROGRESS_KEY = `${KUGOU_ACG_HISTORY_PREFIX}/progress.json`;
export const KUGOU_ACG_HISTORY_TARGETS = Object.freeze(Object.keys(REGIONAL_MUSIC_ARTISTS));

const DAY_MS = 24 * 60 * 60 * 1000;

function normalize(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[\s\p{P}\p{S}]+/gu, '');
}

function periodParts(value) {
  const match = String(value || '').match(/^(\d{4})_(\d{1,2})$/);
  return match ? { year:Number(match[1]), week:Number(match[2]) } : null;
}

export function compareKugouAcgPeriods(left, right) {
  const a = periodParts(left);
  const b = periodParts(right);
  if (!a || !b) return String(left || '').localeCompare(String(right || ''));
  return (a.year - b.year) || (a.week - b.week);
}

export function kugouAcgPeriodDate(period) {
  const parsed = periodParts(period);
  if (!parsed) return '';
  const jan4 = new Date(Date.UTC(parsed.year, 0, 4));
  const jan4Weekday = (jan4.getUTCDay() + 6) % 7;
  const monday = new Date(jan4.getTime() - jan4Weekday * DAY_MS + (parsed.week - 1) * 7 * DAY_MS);
  return new Date(monday.getTime() + 3 * DAY_MS).toISOString().slice(0, 10);
}

function isoWeekPeriodFromDate(dateText) {
  const date = new Date(`${dateText}T00:00:00Z`);
  if (!Number.isFinite(date.getTime())) return null;
  const thursday = new Date(date.getTime());
  const weekday = (thursday.getUTCDay() + 6) % 7;
  thursday.setUTCDate(thursday.getUTCDate() - weekday + 3);
  const year = thursday.getUTCFullYear();
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Weekday = (jan4.getUTCDay() + 6) % 7;
  jan4.setUTCDate(jan4.getUTCDate() - jan4Weekday + 3);
  const week = 1 + Math.round((thursday.getTime() - jan4.getTime()) / (7 * DAY_MS));
  return `${year}_${week}`;
}

function dateFromVolume(value) {
  const text = String(value || '');
  const compact = text.match(/(?:^|\D)(20\d{2})(\d{2})(\d{2})(?:\D|$)/);
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;
  const separated = text.match(/(?:^|\D)(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})(?:\D|$)/);
  if (!separated) return '';
  return `${separated[1]}-${String(Number(separated[2])).padStart(2,'0')}-${String(Number(separated[3])).padStart(2,'0')}`;
}

function issueNumber(volume) {
  for (const value of [volume?.volname, volume?.voltitle, volume?.issue]) {
    const text = String(value || '').trim();
    if (/^20\d{6}$/.test(text)) continue;
    const match = text.match(/(\d{1,2})(?:期)?$/);
    const number = Number(match?.[1]);
    if (Number.isInteger(number) && number >= 1 && number <= 53) return number;
  }
  return null;
}

export function kugouAcgVolumeList(payload) {
  const groups = Array.isArray(payload?.data?.info) ? payload.data.info : [];
  const volumes = [];
  const seen = new Set();
  for (const group of groups) {
    const year = Number(group?.year);
    for (const volume of Array.isArray(group?.vols) ? group.vols : []) {
      const volid = String(volume?.volid ?? '').trim();
      if (!volid || seen.has(volid)) continue;
      const publishedAt = dateFromVolume(volume?.volname) || dateFromVolume(volume?.voltitle);
      const issue = issueNumber(volume);
      const period = publishedAt
        ? isoWeekPeriodFromDate(publishedAt)
        : Number.isInteger(year) && issue ? `${year}_${issue}` : null;
      const resolvedDate = publishedAt || (period ? kugouAcgPeriodDate(period) : '');
      if (!period || !resolvedDate) continue;
      seen.add(volid);
      volumes.push({
        period,
        published_at:resolvedDate,
        year:Number.isInteger(year) ? year : Number(period.split('_')[0]),
        issue:issue || Number(period.split('_')[1]),
        volid,
        volname:volume?.volname ?? null,
        voltitle:volume?.voltitle ?? null,
      });
    }
  }
  return volumes.sort((a,b) => compareKugouAcgPeriods(b.period,a.period) || Number(b.volid)-Number(a.volid));
}

export function kugouAcgVolumeUrl() {
  const params = new URLSearchParams({ rankid:String(KUGOU_ACG_RANK_ID), ranktype:'1', plat:'0', with_rest_tag:'1' });
  return `https://mobilecdnbj.kugou.com/api/v3/rank/vol?${params}`;
}

export function kugouAcgSongsUrl(volid) {
  const params = new URLSearchParams({
    rankid:String(KUGOU_ACG_RANK_ID),
    volid:String(volid),
    pagesize:'100',
    page:'1',
    version:'9108',
    ranktype:'1',
    plat:'0',
    with_res_tag:'1',
  });
  return `https://mobilecdnbj.kugou.com/api/v3/rank/song?${params}`;
}

function canonicalArtistFromEntry(entry) {
  const filename = String(entry?.filename || entry?.FileName || '');
  const artistPart = filename.split(/\s+-\s+/,1)[0] || '';
  const candidates = [
    artistPart,
    entry?.singername,
    entry?.SingerName,
    entry?.author_name,
    entry?.AuthorName,
    ...(Array.isArray(entry?.authors) ? entry.authors.flatMap((author) => [author?.author_name,author?.name]) : []),
  ].filter(Boolean);
  for (const [canonicalArtist, artist] of Object.entries(REGIONAL_MUSIC_ARTISTS)) {
    const aliases = artist.aliases.map(normalize).filter(Boolean);
    if (candidates.some((candidate) => aliases.some((alias) => normalize(candidate).includes(alias)))) return canonicalArtist;
  }
  return null;
}

function titleFromEntry(entry) {
  const filename = String(entry?.filename || entry?.FileName || '').trim();
  const split = filename.match(/^.+?\s+-\s+(.+)$/);
  return String(entry?.remark || entry?.songname || entry?.SongName || split?.[1] || filename || '').trim() || null;
}

function trackIdFromEntry(entry) {
  const direct = entry?.album_audio_id ?? entry?.audio_id ?? entry?.Audioid ?? entry?.audioid;
  if (direct != null && String(direct)) return String(direct);
  const hash = entry?.hash || entry?.FileHash || entry?.filehash;
  return hash ? `hash:${String(hash).toUpperCase()}` : null;
}

export function parseKugouAcgSongs(payload) {
  const rows = Array.isArray(payload?.data?.info) ? payload.data.info : [];
  return rows.map((entry,index) => ({
    position:index + 1,
    canonical_artist:canonicalArtistFromEntry(entry),
    track_id:trackIdFromEntry(entry),
    title:titleFromEntry(entry),
    filename:entry?.filename || entry?.FileName || null,
    hash:entry?.hash || entry?.FileHash || entry?.filehash || null,
  })).filter((entry) => entry.canonical_artist && entry.track_id);
}

export function kugouAcgHistoryR2Key(period) {
  if (!periodParts(period)) throw new Error('invalid Kugou ACG period');
  return `${KUGOU_ACG_HISTORY_PREFIX}/weeks/${period}.json`;
}

function countTargets(entries) {
  return Object.fromEntries(KUGOU_ACG_HISTORY_TARGETS.map((artist) => [artist,
    entries.filter((row) => row.canonical_artist === artist).length]));
}

export function kugouAcgHistoryRecord(volume, entries, collectedAt = Date.now()) {
  if (!volume?.period || !volume?.volid) throw new Error('Kugou ACG volume is incomplete');
  const filtered = (Array.isArray(entries) ? entries : []).filter((entry) => KUGOU_ACG_HISTORY_TARGETS.includes(entry.canonical_artist));
  return {
    version:1,
    service:'kugou_music',
    chart:'acg_new_chart',
    rank_id:KUGOU_ACG_RANK_ID,
    period:volume.period,
    published_at:volume.published_at,
    issue:volume.issue,
    volid:String(volume.volid),
    collected_at:Number(collectedAt),
    source_url:`https://www.kugou.com/yy/rank/home/1-${KUGOU_ACG_RANK_ID}.html?from=rank`,
    counts:countTargets(filtered),
    entries:filtered.map((entry) => ({
      position:Number(entry.position),
      canonical_artist:entry.canonical_artist,
      track_id:entry.track_id,
      title:entry.title ?? null,
      filename:entry.filename ?? null,
      hash:entry.hash ?? null,
    })),
  };
}

export function kugouAcgHistorySummary(record) {
  return {
    period:record.period,
    published_at:record.published_at,
    issue:record.issue,
    volid:record.volid,
    collected_at:record.collected_at,
    counts:record.counts,
    entries:Array.isArray(record.entries) ? record.entries.length : 0,
  };
}

export function kugouAcgHistoryRows(record) {
  return (Array.isArray(record?.entries) ? record.entries : []).map((entry) => ({
    period:record.period,
    published_at:record.published_at,
    issue:record.issue,
    volid:record.volid,
    canonical_artist:entry.canonical_artist,
    rank:Number(entry.position),
    title:entry.title ?? null,
    track_id:entry.track_id ?? null,
  }));
}

export function kugouAcgHistoryIndex(weeks = {}, updatedAt = Date.now(), base = {}) {
  const periods = Object.keys(weeks).sort(compareKugouAcgPeriods);
  return {
    ...base,
    version:1,
    service:'kugou_music',
    chart:'acg_new_chart',
    rank_id:KUGOU_ACG_RANK_ID,
    updated_at:Number(updatedAt),
    earliest_period:periods[0] || null,
    latest_period:periods.at(-1) || null,
    weeks,
  };
}

export function kugouAcgHistoryViewFromRows(index, history = [], updatedAt = Date.now()) {
  const rows = [...history]
    .filter((item) => item?.period && KUGOU_ACG_HISTORY_TARGETS.includes(item?.canonical_artist) && Number.isFinite(Number(item?.rank)))
    .sort((a,b) => compareKugouAcgPeriods(b.period,a.period) || Number(a.rank)-Number(b.rank) || String(a.title || '').localeCompare(String(b.title || '')));
  return {
    version:1,
    service:'kugou_music',
    chart:'acg_new_chart',
    rank_id:KUGOU_ACG_RANK_ID,
    updated_at:Number(updatedAt),
    coverage:{
      earliest_period:index?.earliest_period ?? null,
      latest_period:index?.latest_period ?? null,
      stored_periods:Object.keys(index?.weeks || {}).length,
      entries:rows.length,
    },
    history:rows,
  };
}

export async function upsertKugouAcgHistoryArtifacts({ load, save, record, updatedAt = Date.now() }) {
  if (!record?.period) throw new Error('Kugou ACG history record period missing');
  const existingIndex = await load(KUGOU_ACG_HISTORY_INDEX_KEY);
  const weeks = { ...(existingIndex?.weeks || {}) };
  weeks[record.period] = kugouAcgHistorySummary(record);
  const index = kugouAcgHistoryIndex(weeks, updatedAt, existingIndex || {});

  const existingView = await load(KUGOU_ACG_HISTORY_VIEW_KEY);
  const history = (Array.isArray(existingView?.history) ? existingView.history : [])
    .filter((item) => item?.period !== record.period);
  history.push(...kugouAcgHistoryRows(record));
  const view = kugouAcgHistoryViewFromRows(index, history, updatedAt);

  await save(kugouAcgHistoryR2Key(record.period), record);
  await save(KUGOU_ACG_HISTORY_INDEX_KEY, index);
  await save(KUGOU_ACG_HISTORY_VIEW_KEY, view);
  return { index, view };
}

async function fetchJson(fetchImpl, url) {
  const response = await fetchImpl(url, {
    headers:{ accept:'application/json,text/plain,*/*', referer:'https://www.kugou.com/', 'user-agent':'Mozilla/5.0 compatible; skrzk-pages-kugou-acg/1.0' },
    signal:AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Kugou ACG HTTP ${response.status}`);
  const payload = await response.json();
  if (Number(payload?.status) !== 1 || Number(payload?.errcode || 0) !== 0) throw new Error('Kugou ACG provider error');
  return payload;
}

export async function collectLatestKugouAcgHistory({ load, save, fetchImpl = fetch, now = Date.now() }) {
  const volumes = kugouAcgVolumeList(await fetchJson(fetchImpl,kugouAcgVolumeUrl()));
  const latest = volumes[0];
  if (!latest) throw new Error('Kugou ACG returned no volumes');
  const existingIndex = await load(KUGOU_ACG_HISTORY_INDEX_KEY);
  const existing = existingIndex?.weeks?.[latest.period];
  if (String(existing?.volid || '') === String(latest.volid)) {
    return { changed:false, period:latest.period, volid:latest.volid, entries:Number(existing?.entries || 0) };
  }
  const entries = parseKugouAcgSongs(await fetchJson(fetchImpl,kugouAcgSongsUrl(latest.volid)));
  const record = kugouAcgHistoryRecord(latest,entries,now);
  const artifacts = await upsertKugouAcgHistoryArtifacts({load,save,record,updatedAt:now});
  return { changed:true, period:latest.period, volid:latest.volid, entries:record.entries.length, view:artifacts.view };
}
