import { API_BASE, shHeaders } from './collector-config.js';
import {
  extractIds,
  extractQueue,
  normalizeSnapshot,
  validateChannelPayload,
} from './collector-payload.js';
import { jwtExpiryMs, normalizeBearer } from './shared.js';

function finite(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function booleanCode(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'number') return value === 0 ? 0 : 1;
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) return 1;
  if (['false', '0', 'no', 'off', ''].includes(normalized)) return 0;
  return null;
}

function text(value, maximum = 128) {
  const parsed = String(value ?? '').trim().toLowerCase();
  return parsed ? parsed.slice(0, maximum) : null;
}

function robustHostIdentity(channel) {
  const station = channel?.current_station || {};
  const broadcastHosts = Array.isArray(station?.broadcast?.broadcasters)
    ? station.broadcast.broadcasters.filter((value) => (
      value && typeof value === 'object' && !Array.isArray(value) && value.is_host !== false
    ))
    : [];
  const sources = [
    station.host,
    channel?.host,
    station.current_host,
    channel?.current_host,
    station.broadcaster,
    station.dj,
    station.account,
    station.host_account,
    station.owner,
    channel?.owner,
    ...broadcastHosts,
  ].filter((value) => value && typeof value === 'object' && !Array.isArray(value));
  const identities = sources.flatMap((value) => {
    const account = value.account;
    return account && typeof account === 'object' && !Array.isArray(account)
      ? [account, value]
      : [value];
  });
  const accountId = identities
    .flatMap((value) => [value?.account_id, value?.id])
    .map(finite)
    .find((value) => value != null) ?? null;
  const handle = identities
    .flatMap((value) => [value?.handle, value?.username])
    .map((value) => text(value))
    .find(Boolean)
    || text(station?.host_handle)
    || text(station?.host_username)
    || text(channel?.host_handle);
  return { accountId, handle };
}

export async function fetchStationheadChannelResponse(state, config, fetchImpl = fetch) {
  const alias = String(config?.channelAlias || '').trim();
  if (!alias) throw new Error('Stationhead channel alias is missing');
  const response = await fetchImpl(
    `${API_BASE}/channels/alias/${encodeURIComponent(alias)}`,
    {
      headers: shHeaders(state, config),
      signal: AbortSignal.timeout(Math.max(1_000, Number(config?.requestTimeoutMs) || 15_000)),
    },
  );
  const refreshedAuthToken = normalizeBearer(response.headers.get('authorization'));
  return {
    response,
    refreshedAuthToken,
    tokenExpiresAt: refreshedAuthToken ? jwtExpiryMs(refreshedAuthToken) : null,
  };
}

function prepareStationheadSnapshot(channel, expectedAlias, previousState = {}) {
  validateChannelPayload(channel, expectedAlias);
  const state = {
    channelId: previousState?.channelId ?? null,
    stationId: previousState?.stationId ?? null,
  };
  extractIds(channel, state);
  const snapshot = normalizeSnapshot(channel, state, { channelAlias: expectedAlias });
  const host = robustHostIdentity(channel);
  if (host.accountId != null) snapshot.host_account_id = host.accountId;
  if (host.handle) snapshot.host_handle = host.handle;
  return { state, snapshot };
}

export function prepareStationheadChannelPayload(channel, expectedAlias, previousState = {}) {
  const { state, snapshot } = prepareStationheadSnapshot(channel, expectedAlias, previousState);
  return { state, snapshot, queue: extractQueue(channel, state.stationId) };
}

export function compactStationheadSnapshot(channel, expectedAlias) {
  // Read-only snapshot publication must not parse the queue or its like metadata.
  const { snapshot } = prepareStationheadSnapshot(channel, expectedAlias);
  return {
    channel_id: finite(snapshot.channel_id),
    station_id: finite(snapshot.station_id),
    is_broadcasting: booleanCode(snapshot.is_broadcasting),
    listener_count: finite(snapshot.listener_count),
    online_member_count: finite(snapshot.online_member_count),
    total_member_count: finite(snapshot.total_member_count),
    guest_count: finite(snapshot.guest_count),
    reported_total_listens: finite(snapshot.total_listens),
    stream_goal: finite(snapshot.stream_goal),
    reported_current_stream_count: finite(snapshot.current_stream_count),
    host_account_id: finite(snapshot.host_account_id),
    host_handle: text(snapshot.host_handle),
  };
}
