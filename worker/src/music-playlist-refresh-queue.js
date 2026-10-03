import { canonicalizeAppleMusicPlaylistPresentation } from './apple-music-playlist-canonical-presentation.js';
import { collectAppleMusicPlaylists } from './apple-music-playlist-collector.js';
import {
  AMAZON_MUSIC_TRACK_PLAYLIST_MODEL_KEY,
  collectAmazonMusicTrackPlaylists,
} from './amazon-music-track-playlist-collector.js';
import { amazonMusicTrackPlaylistFetch } from './amazon-music-track-playlist-fetch.js';
import { publishAmazonMusicTrackPlaylistModel } from './amazon-music-track-playlist-publisher.js';
import { collectSpotifyPlaylists } from './spotify-playlist-collector.js';

const APPLE_STATE_KEY = 'apple-music/playlists/state.json';
const MAX_BATCHES = 100;
export const MUSIC_PLAYLIST_REFRESH_CRON = '0 5,17 * * *';
export const MUSIC_PLAYLIST_QUEUE_TYPES = Object.freeze([
  'spotify-playlists',
  'apple-playlists',
  'amazon-track-playlists',
]);

async function readJson(r2, key) {
  const object = await r2?.get?.(key);
  if (!object) return null;
  try {
    return typeof object.json === 'function' ? await object.json() : JSON.parse(await object.text());
  } catch {
    return null;
  }
}

async function putJson(r2, key, value) {
  await r2.put(key, JSON.stringify(value), { httpMetadata: { contentType: 'application/json; charset=utf-8' } });
}

async function clearAppleDailyGate(r2) {
  const state = await readJson(r2, APPLE_STATE_KEY);
  if (!state?.scan_date) return false;
  await putJson(r2, APPLE_STATE_KEY, { ...state, scan_date: null });
  return true;
}

function nextMessage(message, handled, target) {
  const processed = Math.max(0, Number(message?.processed) || 0) + Math.max(0, Number(handled) || 0);
  const batch = Math.max(0, Number(message?.batch) || 0) + 1;
  return {
    ...message,
    processed,
    target: Math.max(Number(message?.target) || 0, Number(target) || 0),
    batch,
  };
}

function shouldContinue(message) {
  return message.batch < MAX_BATCHES && message.processed < message.target;
}

async function enqueueNext(env, message) {
  if (!env?.MUSIC_PLAYLIST_QUEUE?.send) throw new Error('MUSIC_PLAYLIST_QUEUE producer binding is required');
  await env.MUSIC_PLAYLIST_QUEUE.send(message);
}

async function runSpotify(env, message) {
  const first = Number(message?.batch || 0) === 0;
  const result = await collectSpotifyPlaylists(env, Date.now(), fetch, { discover: first });
  const next = nextMessage(message, result?.scanned_playlists, result?.known_playlists);
  if (shouldContinue(next)) await enqueueNext(env, next);
  return { ...result, processed: next.processed, target: next.target, batches: next.batch, complete: !shouldContinue(next) };
}

async function runApple(env, message) {
  await clearAppleDailyGate(env?.PAGES_RESPONSE_R2);
  const result = await collectAppleMusicPlaylists(env, Date.now(), fetch);
  const known = Number(result?.discovered_playlists || result?.known_playlists || 0);
  const next = nextMessage(message, result?.scanned_playlists, known);
  if (shouldContinue(next)) {
    await enqueueNext(env, next);
  } else {
    await canonicalizeAppleMusicPlaylistPresentation(env, Date.now(), { force: true });
  }
  return { ...result, processed: next.processed, target: next.target, batches: next.batch, complete: !shouldContinue(next) };
}

async function runAmazon(env, message) {
  const observedAt = Date.now();
  const result = await collectAmazonMusicTrackPlaylists(env, observedAt, amazonMusicTrackPlaylistFetch);
  await publishAmazonMusicTrackPlaylistModel(env, observedAt);
  const next = nextMessage(message, result?.batch_tracks, result?.total_tracks);
  const batchSize = Number(result?.batch_tracks || 0);
  const succeeded = Number(result?.succeeded || 0);
  const failed = Number(result?.failed || 0);
  const unavailable = batchSize > 0 && succeeded <= 0 && failed >= batchSize;
  if (!unavailable && shouldContinue(next)) await enqueueNext(env, next);
  return { ...result, processed: next.processed, target: next.target, batches: next.batch, complete: unavailable || !shouldContinue(next), upstream_unavailable: unavailable };
}

export async function startMusicPlaylistRefresh(env, scheduledAt = Date.now()) {
  if (!env?.MUSIC_PLAYLIST_QUEUE?.send) throw new Error('MUSIC_PLAYLIST_QUEUE producer binding is required');
  const runId = Number(scheduledAt) || Date.now();
  await Promise.all(MUSIC_PLAYLIST_QUEUE_TYPES.map((type) => env.MUSIC_PLAYLIST_QUEUE.send({
    message_type: type,
    run_id: runId,
    batch: 0,
    processed: 0,
    target: 0,
  })));
  return { queued: MUSIC_PLAYLIST_QUEUE_TYPES.length, run_id: runId };
}

export async function runMusicPlaylistQueue(batch, env) {
  for (const message of batch?.messages || []) {
    const body = message?.body || {};
    let result;
    if (body.message_type === 'spotify-playlists') result = await runSpotify(env, body);
    else if (body.message_type === 'apple-playlists') result = await runApple(env, body);
    else if (body.message_type === 'amazon-track-playlists') result = await runAmazon(env, body);
    else throw new Error(`unknown music playlist queue message: ${body.message_type || '(empty)'}`);
    console.log(JSON.stringify({ event: 'music-playlist-refresh-batch', type: body.message_type, run_id: body.run_id, result }));
    message.ack?.();
  }
}

export async function amazonTrackPlaylistModel(env) {
  return readJson(env?.PAGES_RESPONSE_R2, AMAZON_MUSIC_TRACK_PLAYLIST_MODEL_KEY);
}
