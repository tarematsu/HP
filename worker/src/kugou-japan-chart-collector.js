import { canonicalRegionalArtist, REGIONAL_MUSIC_ARTISTS } from './regional-music-service-registry.js';
import { KUGOU_JAPAN_CHART_COVERAGE } from './kugou-japan-chart-history.js';
import { parseKugouApiJson } from './kugou-acg-chart-history.js';

export const KUGOU_JAPAN_CHART_RANK_ID = 31312;
export const KUGOU_JAPAN_CHART_HISTORY_VIEW_KEY = 'regional-music/kugou_music/japan-chart-history/view.json';
export const KUGOU_JAPAN_CHART_TARGETS = Object.freeze(Object.keys(REGIONAL_MUSIC_ARTISTS));

function dateFromVolume(value) {
  const text = String(value || '');
  const compact = text.match(/(?:^|\D)(20\d{2})(\d{2})(\d{2})(?:\D|$)/);
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;
  const separated = text.match(/(?:^|\D)(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})(?:\D|$)/);
  if (!separated) return '';
  return `${separated[1]}-${String(Number(separated[2])).padStart(2, '0')}-${String(Number(separated[3])).padStart(2, '0')}`;
}

function validDate(value) {
  const text = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const parsed = new Date(`${text}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === text;
}

function issueNumber(volume) {
  for (const value of [volume?.issue, volume?.volname, volume?.voltitle]) {
    const text = String(value || '').trim();
    if (dateFromVolume(text)) continue;
    const match = text.match(/(\d{1,3})(?:期)?$/);
    const number = Number(match?.[1]);
    if (Number.isInteger(number) && number >= 1 && number <= 999) return number;
  }
  return null;
}

export function kugouJapanVolumeList(payload) {
  const groups = Array.isArray(payload?.data?.info) ? payload.data.info : [];
  const volumes = [];
  const seen = new Set();
  for (const group of groups) {
    for (const volume of Array.isArray(group?.vols) ? group.vols : []) {
      const volid = String(volume?.volid ?? '').trim();
      if (!volid || seen.has(volid)) continue;
      const publishedAt = [volume?.volname, volume?.voltitle].map(dateFromVolume).find(validDate) || '';
      if (!publishedAt) continue;
      seen.add(volid);
      volumes.push({
        period:publishedAt,
        published_at:publishedAt,
        issue:issueNumber(volume),
        volid,
        volname:volume?.volname ?? null,
        voltitle:volume?.voltitle ?? null,
      });
    }
  }
  return volumes.sort((a, b) => {
    const dateOrder = b.published_at.localeCompare(a.published_at);
    if (dateOrder) return dateOrder;
    const numericOrder = Number(b.volid) - Number(a.volid);
    return Number.isFinite(numericOrder) ? numericOrder : String(b.volid).localeCompare(String(a.volid));
  });
}

export function kugouJapanVolumeUrl() {
  const params = new URLSearchParams({
    rankid:String(KUGOU_JAPAN_CHART_RANK_ID),
    ranktype:'1',
    plat:'0',
    with_rest_tag:'1',
  });
  return `http://mobilecdnbj.kugou.com/api/v3/rank/vol?${params}`;
}

export function kugouJapanSongsUrl(volid) {
  const params = new URLSearchParams({
    rankid:String(KUGOU_JAPAN_CHART_RANK_ID),
    volid:String(volid),
    pagesize:'100',
    page:'1',
    version:'9108',
    ranktype:'1',
    plat:'0',
    with_res_tag:'1',
  });
  return `http://mobilecdnbj.kugou.com/api/v3/rank/song?${params}`;
}

async function responsePayload(response) {
  if (typeof response?.text === 'function') return parseKugouApiJson(await response.text());
  if (typeof response?.json === 'function') return response.json();
  throw new Error('Kugou Japan chart response body is unavailable');
}

async function fetchJson(fetchImpl, url) {
  const response = await fetchImpl(url, {
    headers:{
      accept:'application/json,text/plain,*/*',
      referer:'http://m.kugou.com/',
      'user-agent':'Mozilla/5.0',
    },
    signal:AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Kugou Japan chart HTTP ${response.status}`);
  const payload = await responsePayload(response);
  if (Number(payload?.status) !== 1 || Number(payload?.errcode || 0) !== 0) {
    throw new Error('Kugou Japan chart provider error');
  }
  return payload;
}

function artistCandidates(entry) {
  const filename = String(entry?.filename || entry?.FileName || '');
  const artistPart = filename.split(/\s+-\s+/, 1)[0] || '';
  return [
    artistPart,
    entry?.singername,
    entry?.SingerName,
    entry?.author_name,
    entry?.AuthorName,
    ...(Array.isArray(entry?.authors) ? entry.authors.flatMap((author) => [author?.author_name, author?.name]) : []),
  ].filter(Boolean);
}

function canonicalArtistFromEntry(entry) {
  for (const candidate of artistCandidates(entry)) {
    for (const name of String(candidate).split(/[、,，&;|]/u)) {
      const canonical = canonicalRegionalArtist(name);
      if (canonical) return canonical;
    }
  }
  return null;
}

function titleFromEntry(entry) {
  const filename = String(entry?.filename || entry?.FileName || '').trim();
  const split = filename.match(/^.+?\s+-\s+(.+)$/u);
  return String(entry?.remark || entry?.songname || entry?.SongName || split?.[1] || filename || '').trim() || null;
}

function trackIdFromEntry(entry) {
  const direct = entry?.album_audio_id ?? entry?.audio_id ?? entry?.Audioid ?? entry?.audioid;
  if (direct != null && String(direct)) return String(direct);
  const hash = entry?.hash || entry?.FileHash || entry?.filehash;
  return hash ? `hash:${String(hash).toUpperCase()}` : null;
}

export function parseKugouJapanSongs(payload) {
  const rows = Array.isArray(payload?.data?.info) ? payload.data.info : [];
  const seen = new Set();
  const parsed = [];
  rows.forEach((entry, index) => {
    const canonicalArtist = canonicalArtistFromEntry(entry);
    const trackId = trackIdFromEntry(entry);
    if (!canonicalArtist || !trackId || seen.has(trackId)) return;
    seen.add(trackId);
    parsed.push({
      position:index + 1,
      canonical_artist:canonicalArtist,
      track_id:trackId,
      title:titleFromEntry(entry),
      filename:entry?.filename || entry?.FileName || null,
      hash:entry?.hash || entry?.FileHash || entry?.filehash || null,
    });
  });
  return parsed;
}

function nextDate(value) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function targetCounts(entries) {
  return Object.fromEntries(KUGOU_JAPAN_CHART_TARGETS.map((artist) => [
    artist,
    entries.filter((entry) => entry.canonical_artist === artist).length,
  ]));
}

export function kugouJapanHistoryRecord(volume, entries, collectedAt = Date.now()) {
  if (!validDate(volume?.published_at) || !volume?.volid) {
    throw new Error('Kugou Japan chart volume is incomplete');
  }
  const filtered = (Array.isArray(entries) ? entries : [])
    .filter((entry) => KUGOU_JAPAN_CHART_TARGETS.includes(entry.canonical_artist));
  return {
    version:1,
    service:'kugou_music',
    chart:'japan_new_song_chart',
    rank_id:KUGOU_JAPAN_CHART_RANK_ID,
    period:volume.published_at,
    published_at:volume.published_at,
    issue:volume.issue ?? null,
    volid:String(volume.volid),
    collected_at:Number(collectedAt),
    source_url:`https://www.kugou.com/yy/rank/home/1-${KUGOU_JAPAN_CHART_RANK_ID}.html?from=rank`,
    counts:targetCounts(filtered),
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

export function kugouJapanHistoryRows(record) {
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

export function kugouJapanHistoryViewFromRecord(existing, record, updatedAt = Date.now()) {
  const history = (Array.isArray(existing?.history) ? existing.history : [])
    .filter((item) => item?.published_at !== record.published_at);
  history.push(...kugouJapanHistoryRows(record));
  history.sort((a, b) => String(b.published_at || '').localeCompare(String(a.published_at || ''))
    || Number(a.rank) - Number(b.rank)
    || String(a.canonical_artist || '').localeCompare(String(b.canonical_artist || '')));
  const latestRankIn = record.entries.length
    ? record.published_at
    : existing?.coverage?.latest_rank_in || KUGOU_JAPAN_CHART_COVERAGE.latest_rank_in;
  return {
    version:1,
    service:'kugou_music',
    chart:'japan_new_song_chart',
    rank_id:KUGOU_JAPAN_CHART_RANK_ID,
    updated_at:Number(updatedAt),
    checked_at:Number(updatedAt),
    latest_volid:record.volid,
    coverage:{
      ...KUGOU_JAPAN_CHART_COVERAGE,
      ...(existing?.coverage || {}),
      latest_available:record.published_at,
      latest_checked:nextDate(record.published_at),
      latest_rank_in:latestRankIn,
      entries:Number(KUGOU_JAPAN_CHART_COVERAGE.entries || 0) + history.length,
    },
    history,
  };
}

export async function collectLatestKugouJapanHistory({ load, save, fetchImpl = fetch, now = Date.now() }) {
  const volumes = kugouJapanVolumeList(await fetchJson(fetchImpl, kugouJapanVolumeUrl()));
  const latest = volumes[0];
  if (!latest) throw new Error('Kugou Japan chart returned no date-based volumes');

  const existing = await load(KUGOU_JAPAN_CHART_HISTORY_VIEW_KEY);
  const staticLatest = String(KUGOU_JAPAN_CHART_COVERAGE.latest_available || '').slice(0, 10);
  const storedLatest = String(existing?.coverage?.latest_available || staticLatest).slice(0, 10);
  if (latest.published_at < storedLatest) {
    return { changed:false, stale:true, period:latest.published_at, stored_period:storedLatest, volid:latest.volid };
  }
  if (latest.published_at === storedLatest && (!existing || String(existing.latest_volid || '') === latest.volid)) {
    return { changed:false, period:latest.published_at, volid:latest.volid, entries:0 };
  }

  const songsPayload = await fetchJson(fetchImpl, kugouJapanSongsUrl(latest.volid));
  const sourceRows = songsPayload?.data?.info;
  if (!Array.isArray(sourceRows) || sourceRows.length === 0) {
    throw new Error('Kugou Japan chart returned an empty song list');
  }
  const entries = parseKugouJapanSongs(songsPayload);
  const record = kugouJapanHistoryRecord(latest, entries, now);
  const view = kugouJapanHistoryViewFromRecord(existing, record, now);
  await save(KUGOU_JAPAN_CHART_HISTORY_VIEW_KEY, view);
  return {
    changed:true,
    period:record.period,
    volid:record.volid,
    source_rows:sourceRows.length,
    entries:record.entries.length,
    view,
  };
}
