import { AMAZON_MUSIC_TRACK_PLAYLIST_MODEL_KEY } from './amazon-music-track-playlist-collector.js';
import { pagesR2ResponseKey } from './pages-response-r2.js';

export const AMAZON_MUSIC_TRACK_PLAYLIST_PAGES_MODEL_KEY = 'amazon-music-playlists';

const PUBLIC_HEADERS = Object.freeze({
  'content-type': 'application/json; charset=utf-8',
  'x-content-type-options': 'nosniff',
  vary: 'accept-encoding',
});

async function readJson(r2, key) {
  const object = await r2?.get?.(key);
  if (!object) return null;
  try {
    if (typeof object.json === 'function') return await object.json();
    if (typeof object.text === 'function') return JSON.parse(await object.text());
  } catch {
    return null;
  }
  return null;
}

export async function publishAmazonMusicTrackPlaylistModel(env, observedAt = Date.now()) {
  const r2 = env?.PAGES_RESPONSE_R2;
  if (typeof r2?.get !== 'function' || typeof r2?.put !== 'function') {
    throw new Error('PAGES_RESPONSE_R2 binding is required');
  }
  const model = await readJson(r2, AMAZON_MUSIC_TRACK_PLAYLIST_MODEL_KEY);
  if (!model) return { published: false, reason: 'model-empty' };

  const now = Number(observedAt) || Date.now();
  const key = pagesR2ResponseKey(AMAZON_MUSIC_TRACK_PLAYLIST_PAGES_MODEL_KEY);
  if (!key) throw new Error('Amazon Music playlist public read-model key is unavailable');
  const body = JSON.stringify({ ok: true, ...model });
  const envelope = {
    version: 1,
    status: 200,
    headers: PUBLIC_HEADERS,
    updated_at: now,
    cadence_seconds: 12 * 60 * 60,
    source_revision: `amazon-music-playlists:${Number(model?.observed_at || now)}`,
    renderer_revision: 'amazon-music-playlists-v1',
    body,
  };
  await r2.put(key, JSON.stringify(envelope), {
    httpMetadata: { contentType: 'application/json; charset=utf-8' },
  });

  return {
    published: true,
    pages_object_key: key,
    tracks: Array.isArray(model?.tracks) ? model.tracks.length : 0,
  };
}
