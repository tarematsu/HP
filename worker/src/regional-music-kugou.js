import { visibleHtmlText } from './regional-music-html.js';
import { REGIONAL_MUSIC_ARTISTS } from './regional-music-service-registry.js';
import {
  saveRegionalArtist,
  saveRegionalCollectorState,
  saveRegionalTrack,
} from './regional-music-store.js';

export const KUGOU_ARTIST_PAGES = Object.freeze({
  sakurazaka46: { id: '5317322', url: 'https://pcretry.kugou.com/yueku/v8/singer/home/5317322-0-6-r.html' },
  hinatazaka46: { id: '798934', url: 'https://pcretry.kugou.com/yueku/v8/singer/home/798934-0-6-r.html' },
  nogizaka46: { id: '84243', url: 'https://pcretry.kugou.com/yueku/v8/singer/home/84243-0-6-n.html' },
});
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
    const artistNames = entryArtists(entry).flatMap(name => name.split(/[、,&]/)).map(normalize);
    if (!artistNames.some((name) => wanted.some((alias) => name === alias))) continue;
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
      const profile = KUGOU_ARTIST_PAGES[canonicalArtist];
      const response = await fetchImpl(profile.url, { headers: { accept: 'text/html' } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const entries = parseKugouArtistPage(await response.text(), artist.aliases)
        .map(entry => ({ ...entry, author_id: profile.id }));
      if (!entries.length) throw new Error('public artist catalog returned no verified tracks');
      const authorId = profile.id;
      if (authorId) {
        await saveRegionalArtist(env, {
          service: 'kugou_music',
          canonical_artist: canonicalArtist,
          service_artist_id: authorId,
          display_name: artist.aliases[1],
          profile_url: profile.url,
          observed_at: observedAt,
        });
        artists += 1;
      }

      for (const [index, entry] of entries.entries()) {
        await saveRegionalTrack(env, {
          service: 'kugou_music',
          service_track_id: entry.track_id,
          service_artist_id: entry.author_id || authorId,
          canonical_artist: canonicalArtist,
          title: entry.title,
          album_name: entry.album_name,
          popularity_rank: index + 1,
          popularity_rank_source: 'artist_page_order',
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

export function parseKugouArtistPage(html, aliases) {
  const breadcrumb = String(html || '').match(/<div\b[^>]*class=["']mbx["'][^>]*>([\s\S]*?)<\/div>/i)?.[1];
  const name = visibleHtmlText(breadcrumb).split('>').at(-1)?.trim();
  if (!aliases.some(alias => normalize(alias) === normalize(name))) return [];
  const data = String(html || '').match(/var\s+homeSongs\s*=\s*(\[[\s\S]*?\]);/);
  if (!data) return [];
  try { return parseKugouSearchTracks({ data: { info: JSON.parse(data[1]) } }, aliases); }
  catch { return []; }
}
