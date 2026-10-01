import { parseCompactCount } from './regional-music-html.js';
import { REGIONAL_MUSIC_ARTISTS, normalizeArtistAlias } from './regional-music-service-registry.js';
import {
  saveRegionalArtist,
  saveRegionalCollectorState,
  saveRegionalPlaylist,
  saveRegionalPlaylistMembership,
  saveRegionalPlaylistSnapshot,
  saveRegionalRelease,
  saveRegionalTrack,
} from './regional-music-store.js';

export const YOUTUBE_MUSIC_SERVICE = 'youtube_music';
export const YOUTUBE_MUSIC_ARTIST_FILTER = 'EgWKAQIgAWoMEA4QChADEAQQCRAF';

const YTM_ROOT = 'https://music.youtube.com';
const YTM_API = `${YTM_ROOT}/youtubei/v1`;
const YTM_USER_AGENT = 'Mozilla/5.0 compatible; skrzk-pages-collector/1.0';

function walk(value, visitor) {
  if (!value || typeof value !== 'object') return;
  visitor(value);
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visitor);
    return;
  }
  for (const item of Object.values(value)) walk(item, visitor);
}

function firstObjectByKey(value, key) {
  let found = null;
  walk(value, (node) => {
    if (found || Array.isArray(node)) return;
    if (node[key] && typeof node[key] === 'object') found = node[key];
  });
  return found;
}

function firstValueByKey(value, key) {
  let found = null;
  walk(value, (node) => {
    if (found !== null || Array.isArray(node)) return;
    if (Object.hasOwn(node, key) && node[key] != null) found = node[key];
  });
  return found;
}

function runsText(value) {
  const runs = value?.runs;
  if (!Array.isArray(runs)) return '';
  return runs.map((run) => String(run?.text || '')).join('').trim();
}

function firstFlexText(renderer, index = 0) {
  const column = renderer?.flexColumns?.[index]?.musicResponsiveListItemFlexColumnRenderer;
  return runsText(column?.text);
}

function allRendererText(renderer) {
  const parts = [];
  walk(renderer, (node) => {
    if (!Array.isArray(node?.runs)) return;
    for (const run of node.runs) if (run?.text) parts.push(String(run.text));
  });
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

function browseIdFrom(value) {
  const endpoint = firstObjectByKey(value, 'browseEndpoint');
  return endpoint?.browseId || null;
}

function videoIdFrom(value) {
  if (value?.playlistItemData?.videoId) return value.playlistItemData.videoId;
  const direct = firstValueByKey(value, 'videoId');
  return typeof direct === 'string' && direct ? direct : null;
}

function countFromText(value) {
  const match = String(value || '').replace(/\u00a0/g, ' ').match(/([0-9][0-9,.]*\s*[KMB]?)/i);
  if (!match) return null;
  return parseCompactCount(match[1].replace(/\s+/g, ''));
}

function clientVersion(observedAt) {
  const date = new Date(Number(observedAt) || Date.now()).toISOString().slice(0, 10).replaceAll('-', '');
  return `1.${date}.01.00`;
}

function context(observedAt) {
  return {
    context: {
      client: {
        clientName: 'WEB_REMIX',
        clientVersion: clientVersion(observedAt),
        hl: 'en',
        gl: 'JP',
      },
      user: {},
    },
  };
}

export function parseYouTubeMusicVisitorData(html) {
  const source = String(html || '');
  const matches = source.matchAll(/ytcfg\.set\s*\(\s*({.+?})\s*\)\s*;/g);
  for (const match of matches) {
    try {
      const config = JSON.parse(match[1]);
      const visitorData = String(config?.VISITOR_DATA || '').trim();
      if (visitorData) return visitorData;
    } catch {
      // Ignore unrelated or partial ytcfg payloads and continue scanning.
    }
  }
  return null;
}

async function fetchVisitorData(fetchImpl) {
  try {
    const response = await fetchImpl(YTM_ROOT, {
      headers: {
        accept: 'text/html,application/xhtml+xml',
        'user-agent': YTM_USER_AGENT,
      },
    });
    if (!response.ok) return null;
    return parseYouTubeMusicVisitorData(await response.text());
  } catch {
    return null;
  }
}

async function requestYtm(fetchImpl, endpoint, body, observedAt, visitorData = null) {
  const headers = {
    accept: '*/*',
    'content-type': 'application/json',
    origin: YTM_ROOT,
    referer: `${YTM_ROOT}/`,
    'user-agent': YTM_USER_AGENT,
  };
  if (visitorData) headers['x-goog-visitor-id'] = visitorData;

  const response = await fetchImpl(`${YTM_API}/${endpoint}?alt=json`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ ...context(observedAt), ...body }),
  });
  if (!response.ok) throw new Error(`YouTube Music ${endpoint} HTTP ${response.status}`);
  return response.json();
}

function exactArtistName(value, artist) {
  const normalized = normalizeArtistAlias(value);
  return artist.aliases.some((alias) => normalizeArtistAlias(alias) === normalized);
}

export function parseYouTubeMusicArtistSearch(payload, canonicalArtist) {
  const artist = REGIONAL_MUSIC_ARTISTS[canonicalArtist];
  if (!artist) return null;
  let match = null;
  walk(payload, (node) => {
    if (match) return;
    const renderer = node?.musicResponsiveListItemRenderer;
    if (!renderer) return;
    const name = firstFlexText(renderer, 0);
    const browseId = renderer?.navigationEndpoint?.browseEndpoint?.browseId || browseIdFrom(renderer);
    if (browseId && exactArtistName(name, artist)) match = { browseId, name };
  });
  return match;
}

function parseRelease(renderer) {
  const browseId = renderer?.navigationEndpoint?.browseEndpoint?.browseId || browseIdFrom(renderer);
  if (!browseId?.startsWith('MPRE')) return null;
  const title = runsText(renderer?.title);
  if (!title) return null;
  const subtitle = runsText(renderer?.subtitle);
  const yearMatch = subtitle.match(/\b(19|20)\d{2}\b/);
  let releaseType = 'unknown';
  if (/\bsingle\b/i.test(subtitle)) releaseType = 'single';
  else if (/\bep\b/i.test(subtitle)) releaseType = 'ep';
  else if (/\balbum\b/i.test(subtitle)) releaseType = 'album';
  return {
    service_release_id: browseId,
    title,
    release_type: releaseType,
    release_year: yearMatch ? Number(yearMatch[0]) : null,
    release_url: `${YTM_ROOT}/browse/${encodeURIComponent(browseId)}`,
  };
}

function albumNameFromRenderer(renderer) {
  let album = null;
  walk(renderer?.flexColumns?.[1], (node) => {
    if (album || !Array.isArray(node?.runs)) return;
    for (const run of node.runs) {
      const browseId = run?.navigationEndpoint?.browseEndpoint?.browseId;
      if (browseId?.startsWith('MPRE') && run?.text) {
        album = String(run.text).trim();
        break;
      }
    }
  });
  return album;
}

function parseTrack(renderer, canonicalArtist) {
  const videoId = videoIdFrom(renderer);
  const title = firstFlexText(renderer, 0);
  if (!videoId || !title) return null;
  const musicVideoType = firstValueByKey(renderer, 'musicVideoType');
  if (musicVideoType && musicVideoType !== 'MUSIC_VIDEO_TYPE_ATV') return null;
  const artist = REGIONAL_MUSIC_ARTISTS[canonicalArtist];
  const text = allRendererText(renderer);
  if (artist && !artist.aliases.some((alias) => normalizeArtistAlias(text).includes(normalizeArtistAlias(alias)))) {
    return null;
  }
  return {
    service_track_id: videoId,
    title,
    album_name: albumNameFromRenderer(renderer),
    track_url: `${YTM_ROOT}/watch?v=${encodeURIComponent(videoId)}`,
  };
}

function parsePlaylistShelf(renderer) {
  const title = runsText(renderer?.title);
  const browseId = renderer?.title?.runs?.[0]?.navigationEndpoint?.browseEndpoint?.browseId || browseIdFrom(renderer?.title);
  if (!browseId?.startsWith('VL')) return null;
  const servicePlaylistId = browseId.slice(2);
  const trackIds = [];
  for (const item of renderer?.contents || []) {
    const row = item?.musicResponsiveListItemRenderer;
    const videoId = row ? videoIdFrom(row) : null;
    if (videoId) trackIds.push(videoId);
  }
  return {
    service_playlist_id: servicePlaylistId,
    playlist_name: title || 'Artist songs',
    playlist_url: `${YTM_ROOT}/playlist?list=${encodeURIComponent(servicePlaylistId)}`,
    playlist_type: 'artist_catalog',
    owner_name: 'YouTube Music',
    trackIds,
  };
}

export function parseYouTubeMusicArtistPage(payload, canonicalArtist) {
  const artist = REGIONAL_MUSIC_ARTISTS[canonicalArtist];
  const header = payload?.header?.musicImmersiveHeaderRenderer || firstObjectByKey(payload, 'musicImmersiveHeaderRenderer');
  if (!header) throw new Error('YouTube Music artist header missing');
  const name = runsText(header.title);
  if (!artist || !exactArtistName(name, artist)) throw new Error(`YouTube Music artist identity mismatch: ${name || 'unknown'}`);

  const subscription = header?.subscriptionButton?.subscribeButtonRenderer || {};
  const monthlyAudience = countFromText(runsText(header?.monthlyListenerCount));
  const subscribers = countFromText(runsText(subscription?.subscriberCountText));
  const descriptionShelf = firstObjectByKey(payload, 'musicDescriptionShelfRenderer');
  const totalViews = countFromText(runsText(descriptionShelf?.subheader));

  const tracks = [];
  const seenTracks = new Set();
  const releases = [];
  const seenReleases = new Set();
  const playlists = [];
  const seenPlaylists = new Set();

  walk(payload, (node) => {
    const list = node?.musicResponsiveListItemRenderer;
    if (list) {
      const track = parseTrack(list, canonicalArtist);
      if (track && !seenTracks.has(track.service_track_id)) {
        seenTracks.add(track.service_track_id);
        tracks.push(track);
      }
    }
    const twoRow = node?.musicTwoRowItemRenderer;
    if (twoRow) {
      const release = parseRelease(twoRow);
      if (release && !seenReleases.has(release.service_release_id)) {
        seenReleases.add(release.service_release_id);
        releases.push(release);
      }
    }
    const shelf = node?.musicShelfRenderer;
    if (shelf) {
      const playlist = parsePlaylistShelf(shelf);
      if (playlist && !seenPlaylists.has(playlist.service_playlist_id)) {
        seenPlaylists.add(playlist.service_playlist_id);
        playlists.push(playlist);
      }
    }
  });

  return {
    name,
    channelId: subscription.channelId || null,
    subscribers,
    monthlyAudience,
    totalViews,
    tracks,
    releases,
    playlists,
  };
}

function profileUrl(browseId) {
  return browseId?.startsWith('UC')
    ? `${YTM_ROOT}/channel/${encodeURIComponent(browseId)}`
    : `${YTM_ROOT}/browse/${encodeURIComponent(browseId)}`;
}

export async function collectYouTubeMusic(env, observedAt = Date.now(), fetchImpl = fetch) {
  const failures = [];
  let artists = 0;
  let tracks = 0;
  let releases = 0;
  let playlists = 0;
  let memberships = 0;
  const visitorData = await fetchVisitorData(fetchImpl);

  for (const [canonicalArtist, artist] of Object.entries(REGIONAL_MUSIC_ARTISTS)) {
    try {
      const search = await requestYtm(fetchImpl, 'search', {
        query: artist.displayName,
        params: YOUTUBE_MUSIC_ARTIST_FILTER,
      }, observedAt, visitorData);
      const identity = parseYouTubeMusicArtistSearch(search, canonicalArtist);
      if (!identity?.browseId) throw new Error(`exact artist search result missing for ${artist.displayName}`);

      const page = await requestYtm(fetchImpl, 'browse', { browseId: identity.browseId }, observedAt, visitorData);
      const parsed = parseYouTubeMusicArtistPage(page, canonicalArtist);
      await saveRegionalArtist(env, {
        service: YOUTUBE_MUSIC_SERVICE,
        canonical_artist: canonicalArtist,
        service_artist_id: identity.browseId,
        display_name: parsed.name,
        profile_url: profileUrl(identity.browseId),
        followers: parsed.subscribers,
        monthly_audience: parsed.monthlyAudience,
        total_views: parsed.totalViews,
        observed_at: observedAt,
      });
      artists += 1;

      for (const track of parsed.tracks) {
        await saveRegionalTrack(env, {
          service: YOUTUBE_MUSIC_SERVICE,
          service_artist_id: identity.browseId,
          canonical_artist: canonicalArtist,
          observed_at: observedAt,
          ...track,
        });
        tracks += 1;
      }

      for (const release of parsed.releases) {
        await saveRegionalRelease(env, {
          service: YOUTUBE_MUSIC_SERVICE,
          canonical_artist: canonicalArtist,
          observed_at: observedAt,
          ...release,
        });
        releases += 1;
      }

      for (const playlist of parsed.playlists) {
        await saveRegionalPlaylist(env, {
          service: YOUTUBE_MUSIC_SERVICE,
          observed_at: observedAt,
          ...playlist,
        });
        await saveRegionalPlaylistSnapshot(env, {
          service: YOUTUBE_MUSIC_SERVICE,
          service_playlist_id: playlist.service_playlist_id,
          item_count: playlist.trackIds.length,
          observed_at: observedAt,
        });
        playlists += 1;
        for (const [index, serviceTrackId] of playlist.trackIds.entries()) {
          await saveRegionalPlaylistMembership(env, {
            service: YOUTUBE_MUSIC_SERVICE,
            service_playlist_id: playlist.service_playlist_id,
            service_track_id: serviceTrackId,
            position: index + 1,
            observed_at: observedAt,
          });
          memberships += 1;
        }
      }
    } catch (error) {
      failures.push({ canonical_artist: canonicalArtist, error: String(error?.message || error) });
    }
  }

  const useful = artists + tracks + releases + playlists;
  const status = failures.length === 0 ? 'ok' : useful ? 'degraded' : 'error';
  await saveRegionalCollectorState(env, {
    service: YOUTUBE_MUSIC_SERVICE,
    status,
    last_attempt_at: observedAt,
    last_success_at: useful ? observedAt : null,
    last_error_class: failures.length ? 'collection_error' : null,
    last_error_message: failures.length ? JSON.stringify(failures).slice(0, 1000) : null,
    entity_counts: { artists, tracks, releases, playlists, memberships, failures: failures.length },
    updated_at: observedAt,
  });

  return { service: YOUTUBE_MUSIC_SERVICE, status, artists, tracks, releases, playlists, memberships, failures };
}
