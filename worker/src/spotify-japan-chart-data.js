import { SPOTIFY_MONTHLY_LISTENER_ARTISTS } from './spotify-monthly-listeners.js';

const roster = SPOTIFY_MONTHLY_LISTENER_ARTISTS;
const nameKey = value => String(value || '').normalize('NFKC').replace(/\s+/gu, '').toLowerCase();
const byName = new Map(roster.map(artist => [nameKey(artist.artist_name), artist]));
const byId = new Map(roster.map(artist => [artist.spotify_artist_id, artist]));
export function spotifyEntityId(value) {
  return String(value || '').match(/(?:spotify:(?:artist|track|album):|\/(?:artist|track|album)\/)([A-Za-z0-9]+)/)?.[1] || '';
}
function int(value, min = 0, max = Number.MAX_SAFE_INTEGER) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= min && n <= max ? n : null;
}
export function normalizeJapanChart(payload, spec, requestedDate = '', now = Date.now()) {
  if (!Array.isArray(payload?.entries) || payload.entries.length < Math.min(50, spec.limit) || payload.entries.length > spec.limit) {
    throw new Error(`Invalid Spotify chart entries: ${spec.id}`);
  }
  // chartDate is authoritative; never pick dates embedded in release metadata.
  const date = String(payload.chartDate || payload.displayChart?.date || payload.date || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || (requestedDate && requestedDate !== date)) {
    throw new Error(`Invalid Spotify chart date: ${spec.id}`);
  }
  const alias = payload.displayChart?.chartMetadata?.alias;
  if (alias && String(alias).toLowerCase().replaceAll('_', '-') !== spec.id) throw new Error('Unexpected Spotify chart alias');
  const matches = [];
  const seen = new Set();
  for (const raw of payload.entries) {
    const data = raw?.chartEntryData;
    const rank = int(data?.currentRank, 1, spec.limit);
    const meta = spec.type === 'artist' ? raw.artistMetadata : spec.type === 'album' ? raw.albumMetadata : raw.trackMetadata;
    if (!rank || !meta || seen.has(rank)) throw new Error(`Malformed Spotify chart row: ${spec.id}`);
    seen.add(rank);
    const credits = spec.type === 'artist' ? [{ name: meta.artistName, uri: meta.artistUri }]
      : meta.artists || meta.artistMetadata || [];
    if (!Array.isArray(credits) || !credits.length) throw new Error(`Missing Spotify chart artists: ${spec.id}`);
    const artists = new Map();
    for (const credit of credits) {
      const id = spotifyEntityId(credit.spotifyUri || credit.uri || credit.artistUri);
      // An explicit ID takes precedence; do not match a different artist by name.
      const artist = id ? byId.get(id) : byName.get(nameKey(credit.name || credit.artistName));
      if (artist) artists.set(artist.artist_key, artist);
    }
    if (!artists.size) continue;
    const uri = meta.trackUri || meta.albumUri || meta.artistUri || meta.uri;
    const id = spotifyEntityId(uri);
    const title = String(meta.trackName || meta.albumName || meta.artistName || meta.name || '').trim();
    if (!id || !title) throw new Error(`Missing Spotify chart identity: ${spec.id}`);
    const streamMetric = (raw.metrics || []).find(metric => /^(streams|stream_count)$/i.test(String(metric.type || metric.name || '')));
    matches.push({ id, title, rank,
      artists: [...artists.keys()], artist_name: [...artists.values()].map(artist => artist.artist_name).join(' / '),
      previous_rank: int(data.previousRank, 1, spec.limit), peak_rank: int(data.peakRank, 1, spec.limit),
      appearances: int(data.appearancesOnChart), streak: int(data.consecutiveAppearancesOnChart),
      streams: spec.type === 'regional' ? int(data.rankingMetric?.type === 'STREAMS' ? data.rankingMetric.value : streamMetric?.value ?? data.streamCount ?? raw.streamCount) : null,
    });
  }
  // Only a fully validated response can establish that tracked artists were absent.
  const sourceStart = String(payload.displayChart?.chartMetadata?.dimensions?.earliestDate || '').slice(0, 10);
  return { chart_date: date, observed_at: now, status: 'ok', entries: matches,
    source_start: /^\d{4}-\d{2}-\d{2}$/.test(sourceStart) ? sourceStart : null };
}
