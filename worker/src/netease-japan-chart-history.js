export const NETEASE_JAPAN_CHART_ID = '5059644681';
export const NETEASE_JAPAN_CHART_NAME = '网易云日语榜';
export const NETEASE_JAPAN_HISTORY_VIEW_KEY = 'regional-music/netease_cloud_music/japan-chart-history/view.json';
export const NETEASE_JAPAN_HISTORY_TARGETS = Object.freeze([
  'sakurazaka46',
  'nogizaka46',
  'hinatazaka46',
]);

function dateOnly(value) {
  const text = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  const number = Number(value);
  if (Number.isFinite(number) && number > 0) return new Date(number).toISOString().slice(0, 10);
  return null;
}

function compareDates(left, right) {
  return String(left || '').localeCompare(String(right || ''));
}

function chartPlaylist(snapshot) {
  return (Array.isArray(snapshot?.playlists) ? snapshot.playlists : [])
    .find((item) => String(item?.service_playlist_id || '') === NETEASE_JAPAN_CHART_ID) || null;
}

export function neteaseJapanHistoryRecordFromSnapshot(snapshot, collectedAt = Date.now()) {
  if (snapshot?.service !== 'netease_cloud_music') return null;
  const playlist = chartPlaylist(snapshot);
  if (!playlist) return null;

  const publishedAt = dateOnly(playlist.provider_update_date)
    || dateOnly(playlist.provider_updated_at)
    || dateOnly(snapshot.day)
    || dateOnly(collectedAt);
  if (!publishedAt) return null;

  const trackById = new Map((Array.isArray(snapshot?.tracks) ? snapshot.tracks : [])
    .map((item) => [String(item?.service_track_id || ''), item]));
  const entries = (Array.isArray(snapshot?.playlist_memberships) ? snapshot.playlist_memberships : [])
    .filter((item) => String(item?.service_playlist_id || '') === NETEASE_JAPAN_CHART_ID)
    .map((item) => {
      const track = trackById.get(String(item?.service_track_id || ''));
      return {
        position:Number(item?.position),
        track_id:String(item?.service_track_id || ''),
        title:track?.title ?? null,
        album_name:track?.album_name ?? null,
        canonical_artist:track?.canonical_artist ?? null,
      };
    })
    .filter((item) => NETEASE_JAPAN_HISTORY_TARGETS.includes(item.canonical_artist)
      && Number.isFinite(item.position) && item.position > 0)
    .sort((a, b) => a.position - b.position || String(a.title || '').localeCompare(String(b.title || '')));

  return {
    version:1,
    service:'netease_cloud_music',
    chart:'netease_japanese_toplist',
    playlist_id:NETEASE_JAPAN_CHART_ID,
    period:publishedAt,
    published_at:publishedAt,
    provider_updated_at:Number(playlist.provider_updated_at) || null,
    collected_at:Number(collectedAt) || Date.now(),
    entries,
  };
}

function rowFromEntry(record, entry) {
  return {
    period:record.period,
    published_at:record.published_at,
    provider_updated_at:record.provider_updated_at ?? null,
    canonical_artist:entry.canonical_artist,
    rank:Number(entry.position),
    title:entry.title ?? null,
    track_id:entry.track_id ?? null,
    album_name:entry.album_name ?? null,
  };
}

function periodSummary(record) {
  return {
    period:record.period,
    published_at:record.published_at,
    provider_updated_at:record.provider_updated_at ?? null,
    entries:Array.isArray(record.entries) ? record.entries.length : 0,
  };
}

function fingerprintPeriod(period, history) {
  return history
    .filter((item) => item?.period === period)
    .map((item) => [item.canonical_artist, item.rank, item.track_id, item.title].join(':'))
    .sort()
    .join('|');
}

export function neteaseJapanHistoryView(records = [], updatedAt = Date.now()) {
  const periods = [];
  const history = [];
  for (const record of records) {
    if (!record?.period) continue;
    periods.push(periodSummary(record));
    for (const entry of Array.isArray(record.entries) ? record.entries : []) history.push(rowFromEntry(record, entry));
  }
  const dedupedPeriods = [...new Map(periods.map((item) => [item.period, item])).values()]
    .sort((a, b) => compareDates(a.period, b.period));
  const dedupedHistory = [...new Map(history.map((item) => [
    [item.period,item.canonical_artist,item.rank,item.track_id].join('|'), item,
  ])).values()].sort((a, b) => compareDates(b.period, a.period)
    || Number(a.rank) - Number(b.rank)
    || String(a.title || '').localeCompare(String(b.title || '')));
  return {
    version:1,
    service:'netease_cloud_music',
    chart:'netease_japanese_toplist',
    playlist_id:NETEASE_JAPAN_CHART_ID,
    updated_at:Number(updatedAt) || Date.now(),
    coverage:{
      earliest_period:dedupedPeriods[0]?.period ?? null,
      latest_period:dedupedPeriods.at(-1)?.period ?? null,
      stored_periods:dedupedPeriods.length,
      entries:dedupedHistory.length,
    },
    periods:dedupedPeriods,
    history:dedupedHistory,
  };
}

export async function upsertNeteaseJapanHistoryArtifacts({ load, save, record, updatedAt = Date.now() }) {
  if (!record?.period) return { changed:false, view:null };
  const existing = await load(NETEASE_JAPAN_HISTORY_VIEW_KEY);
  const periods = Array.isArray(existing?.periods) ? existing.periods.filter((item) => item?.period !== record.period) : [];
  const history = Array.isArray(existing?.history) ? existing.history.filter((item) => item?.period !== record.period) : [];
  const nextRows = (Array.isArray(record.entries) ? record.entries : []).map((entry) => rowFromEntry(record, entry));

  const previousFingerprint = fingerprintPeriod(record.period, Array.isArray(existing?.history) ? existing.history : []);
  const nextFingerprint = fingerprintPeriod(record.period, nextRows);
  const existingPeriod = (Array.isArray(existing?.periods) ? existing.periods : []).find((item) => item?.period === record.period);
  if (existingPeriod && previousFingerprint === nextFingerprint
      && Number(existingPeriod.provider_updated_at || 0) === Number(record.provider_updated_at || 0)) {
    return { changed:false, view:existing };
  }

  const next = {
    version:1,
    service:'netease_cloud_music',
    chart:'netease_japanese_toplist',
    playlist_id:NETEASE_JAPAN_CHART_ID,
    updated_at:Number(updatedAt) || Date.now(),
    periods:[...periods, periodSummary(record)].sort((a, b) => compareDates(a.period, b.period)),
    history:[...history, ...nextRows].sort((a, b) => compareDates(b.period, a.period)
      || Number(a.rank) - Number(b.rank)
      || String(a.title || '').localeCompare(String(b.title || ''))),
  };
  next.coverage = {
    earliest_period:next.periods[0]?.period ?? null,
    latest_period:next.periods.at(-1)?.period ?? null,
    stored_periods:next.periods.length,
    entries:next.history.length,
  };
  await save(NETEASE_JAPAN_HISTORY_VIEW_KEY, next);
  return { changed:true, view:next };
}
