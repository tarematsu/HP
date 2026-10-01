import { REGIONAL_MUSIC_ARTISTS } from './regional-music-service-registry.js';
import {
  saveRegionalArtist,
  saveRegionalCollectorState,
  saveRegionalTrack,
} from './regional-music-store.js';

const KUGOU_SEARCH_LIMIT = 30;

function normalize(value) {
  return String(value || '').normalize('NFKC').toLocaleLowerCase('en-US').replace(/\s+/g, '');
}

export function kugouSearchUrl(query) {
  const params = new URLSearchParams({
    format: 'json',
    plat: '0',
    version: '9108',
    page: '1',
    pagesize: String(KUGOU_SEARCH_LIMIT),
    showtype: '1',
    keyword: query,
  });
  return `https://msearchcdn.kugou.com/api/v3/search/song?${params}`;
}

export function kugouSingerUrl(authorId) {
  return `https://www.kugou.com/singer/info/${encodeURIComponent(authorId)}/`;
}

function entryArtists(entry) {
  const names = [
    entry?.singername,
    entry?.SingerName,
    entry?.author_name,
    entry?.AuthorName,
  ].filter(Boolean);
  if (Array.isArray(entry?.authors)) {
    for (const author of entry.authors) if (author?.author_name || author?.name) names.push(author.author_name || author.name);
  }
  return names;
}

function entryAuthorId(entry) {
  const direct = entry?.author_id ?? entry?.AuthorId ?? entry?.singer_id ?? entry?.SingerId;
  if (direct != null && String(direct) !== '0') return String(direct);
  const authors = Array.isArray(entry?.authors) ? entry.authors : [];
  const nested = authors.find((author) => author?.author_id || author?.id);
  return nested ? String(nested.author_id || nested.id) : null;
}

function entryTrackId(entry) {
  const stable = entry?.album_audio_id ?? entry?.audio_id ?? entry?.Audioid ?? entry?.audioid;
  if (stable != null && String(stable)) return String(stable);
  const hash = entry?.hash || entry?.FileHash || entry?.filehash;
  return hash ? `hash:${String(hash).toUpperCase()}` : null;
}

function entryTitle(entry) {
  return entry?.songname || entry?.SongName || entry?.song_name || entry?.FileName || entry?.filename || null;
}

export function parseKugouSearchTracks(payload, aliases) {
  const list = payload?.data?.info || payload?.data?.lists || payload?.data?.list || [];
  if (!Array.isArray(list)) return [];
  const wanted = aliases.map(normalize);
  const output = [];
  const seen = new Set();
  for (const entry of list) {
    const artistNames = entryArtists(entry).map(normalize);
    if (!artistNames.some((name) => wanted.some((alias) => name === alias || name.includes(alias)))) continue;
    const trackId = entryTrackId(entry);
    if (!trackId || seen.has(trackId)) continue;
    seen.add(trackId);
    const hash = entry?.hash || entry?.FileHash || entry?.filehash || null;
    output.push({
      track_id: trackId,
      title: entryTitle(entry),
      album_name: entry?.album_name || entry?.AlbumName || entry?.albumname || null,
      author_id: entryAuthorId(entry),
      hash: hash ? String(hash) : null,
    });
  }
  return output;
}

async function fetchJson(fetchImpl, url) {
  const response = await fetchImpl(url, {
    headers: {
      accept: 'application/json,text/plain,*/*',
      referer: 'https://www.kugou.com/',
      'user-agent': 'Mozilla/5.0 compatible; skrzk-pages-collector/1.0',
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

export async function collectKugouMusic(env, observedAt = Date.now(), fetchImpl = fetch) {
  const failures = [];
  let artists = 0;
  let tracks = 0;

  for (const [canonicalArtist, artist] of Object.entries(REGIONAL_MUSIC_ARTISTS)) {
    try {
      let entries = [];
      for (const alias of artist.aliases) {
        const payload = await fetchJson(fetchImpl, kugouSearchUrl(alias));
        entries = parseKugouSearchTracks(payload, artist.aliases);
        if (entries.length) break;
      }
      if (!entries.length) throw new Error('catalog search returned no matching tracks');

      const authorId = entries.find((entry) => entry.author_id)?.author_id || null;
      if (authorId) {
        await saveRegionalArtist(env, {
          service: 'kugou_music',
          canonical_artist: canonicalArtist,
          service_artist_id: authorId,
          display_name: artist.aliases[1],
          profile_url: kugouSingerUrl(authorId),
          observed_at: observedAt,
        });
        artists += 1;
      }

      for (const entry of entries) {
        await saveRegionalTrack(env, {
          service: 'kugou_music',
          service_track_id: entry.track_id,
          service_artist_id: entry.author_id || authorId,
          canonical_artist: canonicalArtist,
          title: entry.title,
          album_name: entry.album_name,
          track_url: entry.hash
            ? `https://www.kugou.com/song/#hash=${encodeURIComponent(entry.hash)}`
            : null,
          observed_at: observedAt,
        });
        tracks += 1;
      }
    } catch (error) {
      failures.push({ canonical_artist: canonicalArtist, error: String(error?.message || error) });
    }
  }

  const status = failures.length === 0 ? 'ok' : tracks ? 'degraded' : 'error';
  await saveRegionalCollectorState(env, {
    service: 'kugou_music',
    status,
    last_attempt_at: observedAt,
    last_success_at: tracks ? observedAt : null,
    last_error_class: failures.length ? 'collection_error' : null,
    last_error_message: failures.length ? JSON.stringify(failures).slice(0, 1000) : null,
    entity_counts: { artists, tracks, failures: failures.length },
    updated_at: observedAt,
  });
  return { service: 'kugou_music', status, artists, tracks, failures };
}
