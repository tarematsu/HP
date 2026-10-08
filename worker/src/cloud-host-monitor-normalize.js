import { normalizeComments as sharedNormalizeComments } from './shared.js';
import {
  normalizeStationheadQueue,
  stationheadQueueStructuralPayload,
} from './stationhead-queue-normalize.js';

export function finite(value) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function text(value, maximum = 2_048) {
  const parsed = String(value ?? '').trim();
  return parsed ? parsed.slice(0, maximum) : null;
}

export function identity(station) {
  const broadcast = station?.broadcast || {};
  const host = broadcast?.broadcasters?.find((item) => item?.is_host)
    || broadcast?.broadcasters?.[0]
    || null;
  return {
    stationId: finite(station?.id ?? broadcast?.station_id),
    broadcastId: finite(broadcast?.id),
    broadcastStreamId: broadcast?.stream_id ?? null,
    broadcastStartTime: finite(broadcast?.start_time),
    accountId: finite(station?.owner_id ?? host?.account_id ?? host?.account?.id),
    hostHandle: station?.owner?.handle ?? host?.account?.handle ?? null,
    channelId: finite(station?.channel?.id),
    channelAlias: station?.channel?.alias ?? null,
  };
}

export function normalizeProfile(account, fallbackHandle) {
  if (!account) return null;
  return {
    handle: String(account.handle || fallbackHandle || '').trim(),
    account_id: finite(account.id),
    followers: finite(account.followers),
    following: finite(account.following),
    total_streams: finite(account.total_streams),
    active_stream_days: finite(account.active_stream_days),
    emoji: account.emoji ?? null,
    thumbnail_url: account.thumbnail?.url ?? null,
    medium_url: account.medium?.url ?? null,
    main_url: account.main?.url ?? null,
    badges: Array.isArray(account.badges) ? account.badges : [],
  };
}

export function normalizeComments(payload, stationId) {
  return sharedNormalizeComments(payload, stationId, { finite });
}

export function normalizeQueue(station, observedAt) {
  return normalizeStationheadQueue(
    station?.queue,
    station?.id ?? station?.broadcast?.station_id,
    observedAt,
    { includeAppleMusic: true, includeCurrent: true },
  );
}

export async function digest(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map((part) => part.toString(16).padStart(2, '0')).join('');
}

export async function queueHash(queue) {
  return digest(stationheadQueueStructuralPayload(queue, { includeLikeCounts: true }));
}
