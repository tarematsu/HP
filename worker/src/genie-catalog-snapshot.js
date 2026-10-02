import { REGIONAL_MUSIC_ARTISTS } from './regional-music-service-registry.js';
import { extractGenieTrackIds, findGenieArtistId, genieArtistUrl, genieSongUrl, parseGenieArtistLikes, parseGenieTrackMetrics, parseGenieTrackTitle } from './regional-music-genie.js';
import { regionalMusicSnapshotDate } from './regional-music-store.js';

export const GENIE_SNAPSHOT_KEY = 'regional-music/genie/latest.json';
export const GENIE_ARTIST_IDS = Object.freeze({ sakurazaka46: '80988607', nogizaka46: '80276120', hinatazaka46: '80689952' });
export const genieDayKey = (day) => `regional-music/genie/days/${day}.json`;
export const genieCheckpointKey = (day) => `regional-music/genie/progress/${day}.json`;

export function parseGenieCatalogPage(html) {
  const total = Number(String(html).match(/총\s*<strong>([0-9,]+)<\/strong>/)?.[1]?.replaceAll(',', ''));
  const ids = extractGenieTrackIds(html, 31);
  if (!Number.isInteger(total) || total < 1 || total > 3000 || !ids.length || ids.length > 30) throw new Error('Invalid Genie catalog page');
  if (!/id=["']hdSortType["']\s+value=["']pop7["']/.test(html)) throw new Error('Genie catalog popularity sort changed');
  return { total, ids };
}

export async function discoverGenieCatalog(fetchHtml, observedAt) {
  const artists = [];
  const catalog = [];
  for (const [canonical, id] of Object.entries(GENIE_ARTIST_IDS)) {
    const definition = REGIONAL_MUSIC_ARTISTS[canonical];
    const profile = await fetchHtml(genieArtistUrl(id));
    if (findGenieArtistId(profile, definition.aliases) !== id) throw new Error(`Genie artist identity mismatch: ${canonical}`);
    artists.push({ service:'genie', canonical_artist:canonical, service_artist_id:id, display_name:definition.aliases[1], profile_url:genieArtistUrl(id), likes:parseGenieArtistLikes(profile), observed_at:observedAt, snapshot_date:regionalMusicSnapshotDate(observedAt) });
    const first = parseGenieCatalogPage(await fetchHtml(`https://www.genie.co.kr/detail/artistSong?xxnm=${id}`));
    const ids = [];
    const seen = new Set();
    for (let page = 1; page <= Math.ceil(first.total / 30); page++) {
      const parsed = page === 1 ? first : parseGenieCatalogPage(await fetchHtml('https://www.genie.co.kr/detail/bArtistSongList', `xxnm=${id}&pg=${page}&pgsize=30&otype=pop7&stype=`));
      if (parsed.total !== first.total || parsed.ids.some(track => seen.has(track))) throw new Error(`Genie catalog changed during pagination: ${canonical}`);
      parsed.ids.forEach(track => { seen.add(track); ids.push(track); });
    }
    if (ids.length !== first.total) throw new Error(`Genie catalog count mismatch: ${canonical}`);
    ids.forEach((track, index) => catalog.push({ service:'genie', canonical_artist:canonical, service_artist_id:id, service_track_id:track, track_url:genieSongUrl(track), popularity_rank:index + 1 }));
  }
  return { artists, catalog };
}

function snapshotValid(snapshot) {
  return snapshot?.version === 1 && snapshot?.service === 'genie' && Number.isFinite(snapshot.updated_at) && snapshot.updated_at > 0 && Array.isArray(snapshot.tracks) && Array.isArray(snapshot.artists) && Array.isArray(snapshot.artist_track_orders) && snapshot.state?.service === 'genie';
}

export function mergeGenieSnapshot(payload, snapshot) {
  if (!snapshotValid(snapshot)) return payload;
  const existing = (payload.services || []).find(row => row.service === 'genie');
  // A later legacy five-song attempt must not replace the full R2 catalog.
  // The snapshot's own timestamps preserve freshness and degraded state.
  if (existing?.storage === 'r2' && existing.updated_at > snapshot.updated_at) return payload;
  const replace = (rows, replacement) => [...(rows || []).filter(row => row.service !== 'genie'), ...replacement];
  return { ...payload, updated_at:Math.max(payload.updated_at || 0, snapshot.updated_at), artists:replace(payload.artists, snapshot.artists), tracks:replace(payload.tracks, snapshot.tracks), artist_track_orders:replace(payload.artist_track_orders, snapshot.artist_track_orders), services:replace(payload.services, [{ ...snapshot.state, storage:'r2', metrics:['artist_likes','track_plays','track_listeners','track_likes','catalog'], region:'KR' }]) };
}

export async function collectGenieSnapshot({ fetchHtml, load, save, now = Date.now(), concurrency = 4, checkpointSize = 100 }) {
  const day = regionalMusicSnapshotDate(now);
  const progressKey = genieCheckpointKey(day);
  const previous = await load(GENIE_SNAPSHOT_KEY);
  let progress = await load(progressKey);
  if (progress?.version !== 1 || progress.day !== day || !Array.isArray(progress.catalog) || !Array.isArray(progress.artists) || !Array.isArray(progress.tracks)) {
    progress = { version:1, day, observed_at:now, ...await discoverGenieCatalog(fetchHtml, now), tracks:[] };
    await save(progressKey, progress);
  }
  const completed = new Map(progress.tracks.map(row => [row.service_track_id, row]));
  const pending = [...new Map(progress.catalog.filter(row => !completed.has(row.service_track_id)).map(row => [row.service_track_id, row])).values()];
  const failures = [];
  const width = Math.min(4, Math.max(1, Math.floor(concurrency)));
  const chunkSize = Math.min(100, Math.max(1, Math.floor(checkpointSize)));
  for (let start = 0; start < pending.length; start += chunkSize) {
    const chunk = pending.slice(start,start + chunkSize);
    let index = 0;
    await Promise.all(Array.from({ length:width }, async () => {
      while (index < chunk.length) {
        const row = chunk[index++];
        try {
          const html = await fetchHtml(row.track_url);
          if (findGenieArtistId(html, REGIONAL_MUSIC_ARTISTS[row.canonical_artist].aliases) !== row.service_artist_id) throw new Error('Song artist identity mismatch');
          const metrics = parseGenieTrackMetrics(html);
          if (metrics.plays === null || metrics.listeners === null) throw new Error('Cumulative metrics missing');
          const title = parseGenieTrackTitle(html);
          if (!title) throw new Error('Song title missing');
          completed.set(row.service_track_id, { ...row, ...metrics, title, observed_at:Date.now(), snapshot_date:day });
        } catch (error) { failures.push({ track:row.service_track_id, error:String(error.message).slice(0,150) }); }
      }
    }));
    progress.tracks = [...completed.values()];
    await save(progressKey, progress);
  }
  const oldTracks = new Map((snapshotValid(previous) ? previous.tracks : []).map(row => [row.service_track_id, row]));
  const tracks = progress.catalog.map(row => ({ ...oldTracks.get(row.service_track_id), ...completed.get(row.service_track_id), ...row }));
  const orders = progress.catalog.map(row => ({ ...row, snapshot_date:day, observed_at:progress.observed_at, position:row.popularity_rank, rank_source:'provider_popularity_order' }));
  const updatedAt = Math.max(now, Date.now());
  const missing = [...new Set(progress.catalog.map(row => row.service_track_id))].filter(id => !completed.has(id)).length;
  const snapshot = { version:1, service:'genie', day, updated_at:updatedAt, artists:progress.artists, tracks, artist_track_orders:orders, state:{ service:'genie', status:missing ? 'degraded' : 'ok', last_attempt_at:now, last_success_at:completed.size ? updatedAt : previous?.state?.last_success_at ?? null, updated_at:updatedAt, last_error_class:missing ? 'partial_collection' : null, last_error_message:missing ? `${missing} songs missing current-day metrics` : null, entity_counts:{ artists:progress.artists.length, tracks:tracks.length, current_day_metrics:completed.size, failures:missing }, }, failures };
  await save(genieDayKey(day), snapshot);
  await save(GENIE_SNAPSHOT_KEY, snapshot);
  return snapshot;
}
