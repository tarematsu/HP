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

async function fetchText(url) {
  const response = await fetch(url, { headers });
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 160)}`);
  return text;
}

async function fetchJson(url) {
  return JSON.parse(await fetchText(url));
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
  return parsed.map((track) => {
    const entry = byId.get(track.track_id) || {};
    return {
      track_id: track.track_id,
      title: track.title,
      album_name: track.album_name,
      album_audio_id: entry.album_audio_id ?? null,
      audio_id: entry.audio_id ?? entry.Audioid ?? entry.audioid ?? null,
      album_id: entry.album_id ?? entry.AlbumID ?? entry.albumid ?? null,
      hash: entry.hash ?? entry.FileHash ?? entry.filehash ?? null,
      duration: entry.duration ?? entry.Duration ?? null,
      mvhash: entry.mvhash ?? entry.MvHash ?? null,
      ownercount: entry.ownercount ?? entry.OwnerCount ?? null,
      privilege: entry.privilege ?? entry.Privilege ?? null,
      pay_type: entry.pay_type ?? entry.PayType ?? null,
      isnew: entry.isnew ?? entry.is_new ?? null,
    };
  });
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
    item.artist_page = {
      ok: true,
      track_count: tracks.length,
      sample: tracks.slice(0, 5),
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
