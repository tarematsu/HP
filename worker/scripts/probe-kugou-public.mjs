import {
  KUGOU_ARTIST_PAGES,
  kugouSearchUrl,
  parseKugouArtistPage,
  parseKugouSearchTracks,
} from '../src/regional-music-kugou.js';
import { REGIONAL_MUSIC_ARTISTS } from '../src/regional-music-service-registry.js';

const headers = {
  accept: 'application/json,text/html,text/plain,*/*',
  referer: 'https://www.kugou.com/',
  'user-agent': 'Mozilla/5.0 compatible; skrzk-pages-kugou-probe/1.0',
};

async function fetchText(url, extraHeaders = {}) {
  const response = await fetch(url, { headers: { ...headers, ...extraHeaders } });
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 160)}`);
  return text;
}

async function fetchJson(url, extraHeaders = {}) {
  return JSON.parse(await fetchText(url, extraHeaders));
}

function extractHomeSongs(html) {
  const data = String(html || '').match(/var\s+homeSongs\s*=\s*(\[[\s\S]*?\]);/);
  if (!data) return [];
  try { return JSON.parse(data[1]); } catch { return []; }
}

function summarizeRawSong(entry) {
  const interesting = [
    'album_audio_id','MixSongID','mixsongid','audio_id','Audioid','audioid',
    'album_id','AlbumID','albumid','hash','FileHash','filehash','songname','SongName',
    'filename','FileName','singername','SingerName','album_name','AlbumName','albumname',
    'duration','Duration','mvhash','MvHash','ownercount','OwnerCount','privilege','Privilege',
    'pay_type','PayType','isnew','is_new','author_id','AuthorId','singer_id','SingerId',
  ];
  const out = {};
  for (const key of interesting) if (entry?.[key] !== undefined) out[key] = entry[key];
  return out;
}

function rawSearchMetadata(payload, aliases) {
  const parsed = parseKugouSearchTracks(payload, aliases);
  const raw = payload?.data?.info || payload?.data?.lists || payload?.data?.list || [];
  const byId = new Map();
  for (const entry of Array.isArray(raw) ? raw : []) {
    const id = entry?.album_audio_id ?? entry?.audio_id ?? entry?.Audioid ?? entry?.audioid;
    const hash = entry?.hash || entry?.FileHash || entry?.filehash;
    const key = id != null ? String(id) : hash ? `hash:${String(hash).toUpperCase()}` : null;
    if (key) byId.set(key, entry);
  }
  return parsed.map((track) => ({
    ...track,
    raw: summarizeRawSong(byId.get(track.track_id) || {}),
  }));
}

const output = {
  observed_at: new Date().toISOString(),
  note: 'Read-only diagnostic. No D1/R2 writes and no signed/client-only Kugou endpoints.',
  artists: {},
};

for (const [canonicalArtist, artist] of Object.entries(REGIONAL_MUSIC_ARTISTS)) {
  const profile = KUGOU_ARTIST_PAGES[canonicalArtist];
  const item = { author_id: profile.id, profile_url: profile.url };
  try {
    const html = await fetchText(profile.url);
    const tracks = parseKugouArtistPage(html, artist.aliases);
    const rawSongs = extractHomeSongs(html);
    item.artist_page = {
      ok: true,
      track_count: tracks.length,
      sample: tracks.slice(0, 5),
      raw_home_song_count: rawSongs.length,
      raw_home_song_keys: [...new Set(rawSongs.flatMap((song) => Object.keys(song || {})))].sort(),
      raw_sample: rawSongs.slice(0, 5).map(summarizeRawSong),
    };
  } catch (error) {
    item.artist_page = { ok: false, error: String(error?.message || error) };
  }

  try {
    const payload = await fetchJson(kugouSearchUrl(artist.displayName));
    const tracks = rawSearchMetadata(payload, artist.aliases);
    item.search = {
      ok: true,
      reported_total: payload?.data?.total ?? null,
      verified_track_count: tracks.length,
      sample: tracks.slice(0, 10),
    };
  } catch (error) {
    item.search = { ok: false, error: String(error?.message || error) };
  }

  output.artists[canonicalArtist] = item;
}

console.log(JSON.stringify(output, null, 2));
