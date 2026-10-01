import { REGIONAL_MUSIC_ARTISTS } from './regional-music-service-registry.js';
import {
  saveRegionalArtist,
  saveRegionalCollectorState,
  saveRegionalTrack,
} from './regional-music-store.js';

const QQ_TRACK_LIMIT = 20;

function normalize(value) {
  return String(value || '').normalize('NFKC').toLocaleLowerCase('en-US').replace(/\s+/g, '');
}

function parseJsonLike(text) {
  const source = String(text || '').trim();
  if (!source) throw new Error('empty JSON response');
  try {
    return JSON.parse(source);
  } catch {}
  const match = source.match(/^[^(]*\((\{[\s\S]*\}|\[[\s\S]*\])\)\s*;?$/);
  if (!match) throw new Error('invalid JSON/JSONP response');
  return JSON.parse(match[1]);
}

function candidates(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.itemlist)) return value.itemlist;
  if (Array.isArray(value?.items)) return value.items;
  if (Array.isArray(value?.list)) return value.list;
  return [];
}

export function qqSmartboxUrl(query) {
  const params = new URLSearchParams({
    format: 'json',
    key: query,
    inCharset: 'utf8',
    outCharset: 'utf-8',
    platform: 'yqq',
  });
  return `https://c.y.qq.com/splcloud/fcgi-bin/smartbox_new.fcg?${params}`;
}

export function qqSingerTracksUrl(singerMid) {
  const params = new URLSearchParams({
    singermid: singerMid,
    order: 'listen',
    begin: '0',
    num: String(QQ_TRACK_LIMIT),
    format: 'json',
  });
  return `https://c.y.qq.com/v8/fcg-bin/fcg_v8_singer_track_cp.fcg?${params}`;
}

export function qqSingerUrl(singerMid) {
  return `https://y.qq.com/n/ryqq/singer/${encodeURIComponent(singerMid)}`;
}

export function qqSongUrl(songMid) {
  return `https://y.qq.com/n/ryqq/songDetail/${encodeURIComponent(songMid)}`;
}

export function parseQqSingerId(payload, aliases) {
  const wanted = aliases.map(normalize);
  const roots = [
    payload?.data?.singer,
    payload?.data?.artist,
    payload?.singer,
    payload?.artist,
  ];
  for (const root of roots) {
    for (const item of candidates(root)) {
      const label = normalize(item?.name || item?.singername || item?.singer_name || item?.title);
      if (!label || !wanted.some((alias) => label === alias || label.includes(alias))) continue;
      const mid = item?.mid || item?.singermid || item?.singer_mid || item?.id;
      if (mid != null && String(mid)) return String(mid);
    }
  }
  return null;
}

function qqArtists(track) {
  const list = track?.singer || track?.singers || track?.artist || track?.artists || [];
  if (!Array.isArray(list)) return [];
  return list.map((item) => ({
    mid: item?.mid || item?.singermid || item?.id || null,
    name: item?.name || item?.singername || item?.title || '',
  }));
}

export function parseQqSingerTracks(payload, singerMid, aliases) {
  const list = payload?.data?.list || payload?.data?.songlist || payload?.list || [];
  if (!Array.isArray(list)) return [];
  const wanted = aliases.map(normalize);
  const output = [];
  for (const [index, wrapper] of list.entries()) {
    const track = wrapper?.musicData || wrapper?.songInfo || wrapper?.song || wrapper;
    const artists = qqArtists(track);
    if (artists.length && !artists.some((artist) =>
      String(artist.mid || '') === String(singerMid)
      || wanted.some((alias) => normalize(artist.name) === alias))) continue;
    const songMid = track?.songmid || track?.mid || track?.song_mid;
    if (!songMid) continue;
    output.push({
      track_id: String(songMid),
      title: track?.songname || track?.name || track?.title || null,
      album_name: track?.albumname || track?.album?.name || null,
      rank: index + 1,
    });
  }
  return output;
}

async function fetchJson(fetchImpl, url) {
  const response = await fetchImpl(url, {
    headers: {
      accept: 'application/json,text/plain,*/*',
      referer: 'https://y.qq.com/',
      'user-agent': 'Mozilla/5.0 compatible; skrzk-pages-collector/1.0',
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return parseJsonLike(await response.text());
}

async function discoverSinger(fetchImpl, artist) {
  for (const alias of artist.aliases) {
    const payload = await fetchJson(fetchImpl, qqSmartboxUrl(alias));
    const id = parseQqSingerId(payload, artist.aliases);
    if (id) return id;
  }
  return null;
}

export async function collectQqMusic(env, observedAt = Date.now(), fetchImpl = fetch) {
  const failures = [];
  let artists = 0;
  let tracks = 0;

  for (const [canonicalArtist, artist] of Object.entries(REGIONAL_MUSIC_ARTISTS)) {
    try {
      const singerMid = await discoverSinger(fetchImpl, artist);
      if (!singerMid) throw new Error('singer mid not found');
      await saveRegionalArtist(env, {
        service: 'qq_music',
        canonical_artist: canonicalArtist,
        service_artist_id: singerMid,
        display_name: artist.aliases[1],
        profile_url: qqSingerUrl(singerMid),
        observed_at: observedAt,
      });
      artists += 1;

      const payload = await fetchJson(fetchImpl, qqSingerTracksUrl(singerMid));
      const entries = parseQqSingerTracks(payload, singerMid, artist.aliases);
      for (const entry of entries) {
        await saveRegionalTrack(env, {
          service: 'qq_music',
          service_track_id: entry.track_id,
          service_artist_id: singerMid,
          canonical_artist: canonicalArtist,
          title: entry.title,
          album_name: entry.album_name,
          track_url: qqSongUrl(entry.track_id),
          popularity_rank: entry.rank,
          observed_at: observedAt,
        });
        tracks += 1;
      }
      if (!entries.length) throw new Error('singer track list empty');
    } catch (error) {
      failures.push({ canonical_artist: canonicalArtist, error: String(error?.message || error) });
    }
  }

  const status = failures.length === 0 ? 'ok' : (artists || tracks) ? 'degraded' : 'error';
  await saveRegionalCollectorState(env, {
    service: 'qq_music',
    status,
    last_attempt_at: observedAt,
    last_success_at: (artists || tracks) ? observedAt : null,
    last_error_class: failures.length ? 'collection_error' : null,
    last_error_message: failures.length ? JSON.stringify(failures).slice(0, 1000) : null,
    entity_counts: { artists, tracks, failures: failures.length },
    updated_at: observedAt,
  });
  return { service: 'qq_music', status, artists, tracks, failures };
}
