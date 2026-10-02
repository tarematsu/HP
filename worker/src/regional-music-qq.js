import { REGIONAL_MUSIC_ARTISTS } from './regional-music-service-registry.js';
import {
  saveRegionalArtist,
  saveRegionalCollectorState,
  saveRegionalPlaylist,
  saveRegionalPlaylistMembership,
  saveRegionalPlaylistSnapshot,
  saveRegionalTrack,
} from './regional-music-store.js';

const QQ_TRACK_LIMIT = 20;
export const QQ_JAPAN_TOPLIST_ID = 17;
export const QQ_JAPAN_TOPLIST_LIMIT = 100;
export const QQ_JAPAN_TOPLIST_PLAYLIST_ID = `toplist:${QQ_JAPAN_TOPLIST_ID}`;

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
  const data = { comm: { ct:24, cv:0 }, req_1: {
    module: 'musichall.song_list_server', method: 'GetSingerSongList',
    param: { singerMid, order:1, begin:0, num:QQ_TRACK_LIMIT },
  } };
  return `https://u.y.qq.com/cgi-bin/musicu.fcg?${new URLSearchParams({data:JSON.stringify(data)})}`;
}

export function qqJapanToplistUrl() {
  const data = { comm: { ct:24, cv:0 }, req_1: {
    module: 'musicToplist.ToplistInfoServer', method: 'GetDetail',
    param: { topId:QQ_JAPAN_TOPLIST_ID, offset:0, num:QQ_JAPAN_TOPLIST_LIMIT, period:'' },
  } };
  return `https://u.y.qq.com/cgi-bin/musicu.fcg?${new URLSearchParams({g_tk:'5381',format:'json',data:JSON.stringify(data)})}`;
}

export function qqSingerUrl(singerMid) {
  return `https://y.qq.com/n/ryqq/singer/${encodeURIComponent(singerMid)}`;
}

export function qqSongUrl(songMid) {
  return `https://y.qq.com/n/ryqq/songDetail/${encodeURIComponent(songMid)}`;
}

export function qqJapanToplistPageUrl() {
  return `https://y.qq.com/n/ryqq/toplist/${QQ_JAPAN_TOPLIST_ID}`;
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
      if (!label || !wanted.includes(label)) continue;
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

function canonicalArtistForQqArtists(artists) {
  const normalized = artists.map((artist) => normalize(artist.name));
  return Object.entries(REGIONAL_MUSIC_ARTISTS).find(([, definition]) =>
    definition.aliases.some((alias) => normalized.includes(normalize(alias))))?.[0] || null;
}

export function parseQqSingerTracks(payload, singerMid, aliases) {
  const list = payload?.req_1?.data?.songList || payload?.data?.list || payload?.data?.songlist || payload?.list || [];
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

export function parseQqJapanToplist(payload) {
  const data = payload?.req_1?.data || payload?.detail?.data || payload?.data || {};
  const list = data?.songInfoList || data?.songlist || data?.list || [];
  if (!Array.isArray(list)) return { title:'日本榜', update_time:null, entries:[] };
  const entries = [];
  for (const [index, wrapper] of list.entries()) {
    const track = wrapper?.songInfo || wrapper?.musicData || wrapper?.song || wrapper;
    const trackId = track?.mid || track?.songmid || track?.song_mid || track?.id;
    if (trackId == null || !String(trackId)) continue;
    const artists = qqArtists(track);
    entries.push({
      track_id:String(trackId),
      title:track?.title || track?.name || track?.songname || null,
      album_name:track?.album?.name || track?.albumname || null,
      artists,
      canonical_artist:canonicalArtistForQqArtists(artists),
      position:index + 1,
    });
  }
  return {
    title:data?.title || data?.titleDetail || '日本榜',
    update_time:data?.updateTime || data?.update_time || null,
    entries,
  };
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

async function collectJapanToplist(env, observedAt, fetchImpl) {
  const payload = await fetchJson(fetchImpl, qqJapanToplistUrl());
  if (payload?.code || payload?.req_1?.code) throw new Error('Japan toplist API returned a provider error');
  const chart = parseQqJapanToplist(payload);
  if (!chart.entries.length) throw new Error('Japan toplist empty');

  await saveRegionalPlaylist(env, {
    service:'qq_music',
    service_playlist_id:QQ_JAPAN_TOPLIST_PLAYLIST_ID,
    playlist_name:chart.title || '日本榜',
    playlist_url:qqJapanToplistPageUrl(),
    playlist_type:'chart',
    owner_name:'QQ Music',
    provider_update_time:chart.update_time,
    observed_at:observedAt,
  });
  await saveRegionalPlaylistSnapshot(env, {
    service:'qq_music',
    service_playlist_id:QQ_JAPAN_TOPLIST_PLAYLIST_ID,
    item_count:chart.entries.length,
    observed_at:observedAt,
  });

  for (const entry of chart.entries) {
    const canonicalSinger = entry.canonical_artist
      ? entry.artists.find((artist) => REGIONAL_MUSIC_ARTISTS[entry.canonical_artist].aliases.some((alias) => normalize(alias) === normalize(artist.name)))
      : null;
    await saveRegionalTrack(env, {
      service:'qq_music',
      service_track_id:entry.track_id,
      service_artist_id:canonicalSinger?.mid || null,
      canonical_artist:entry.canonical_artist,
      title:entry.title,
      album_name:entry.album_name,
      track_url:qqSongUrl(entry.track_id),
      provider_artists:entry.artists.map((artist) => artist.name).filter(Boolean),
      observed_at:observedAt,
    });
    await saveRegionalPlaylistMembership(env, {
      service:'qq_music',
      service_playlist_id:QQ_JAPAN_TOPLIST_PLAYLIST_ID,
      service_track_id:entry.track_id,
      position:entry.position,
      observed_at:observedAt,
    });
  }
  return chart;
}

export async function collectQqMusic(env, observedAt = Date.now(), fetchImpl = fetch) {
  const failures = [];
  let artists = 0;
  let tracks = 0;
  let japanChartEntries = 0;

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
      if (payload?.code || payload?.req_1?.code) throw new Error('catalog API returned a provider error');
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

  try {
    const chart = await collectJapanToplist(env, observedAt, fetchImpl);
    japanChartEntries = chart.entries.length;
    tracks += chart.entries.length;
  } catch (error) {
    failures.push({ chart:'japan_toplist', error:String(error?.message || error) });
  }

  const status = failures.length === 0 ? 'ok' : (artists || tracks) ? 'degraded' : 'error';
  await saveRegionalCollectorState(env, {
    service: 'qq_music',
    status,
    last_attempt_at: observedAt,
    last_success_at: (artists || tracks) ? observedAt : null,
    last_error_class: failures.length ? 'collection_error' : null,
    last_error_message: failures.length ? JSON.stringify(failures).slice(0, 1000) : null,
    entity_counts: { artists, tracks, japan_chart_entries:japanChartEntries, failures: failures.length },
    updated_at: observedAt,
  });
  return { service: 'qq_music', status, artists, tracks, japan_chart_entries:japanChartEntries, failures };
}
