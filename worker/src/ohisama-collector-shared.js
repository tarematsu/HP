import { firstDefined } from './collector-config.js';
import { OHISAMA_CRON } from './scheduled-crons.js';
import { STATIONHEAD_FOLLOWER_SOURCE } from './stationhead-follower-membership.js';

const FIVE_MINUTES_MS = 5 * 60_000;

export const OHISAMA_COLLECTOR_CRON = OHISAMA_CRON;

function nullableNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function nullableBooleanCode(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'number') return value === 0 ? 0 : 1;
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) return 1;
  if (['false', '0', 'no', 'off', ''].includes(normalized)) return 0;
  return null;
}

function normalizedHandle(value) {
  const handle = String(value || '').trim().toLowerCase();
  return handle && handle.length <= 128 ? handle : null;
}

export function fiveMinuteBucket(timestamp) {
  const parsed = Number(timestamp);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error('invalid observation timestamp');
  return Math.floor(parsed / FIVE_MINUTES_MS) * FIVE_MINUTES_MS;
}

export function normalizeOhisamaSnapshot(channel, expectedAlias = 'ohisama') {
  if (!channel || typeof channel !== 'object' || Array.isArray(channel)) {
    throw new Error('Stationhead channel response is not an object');
  }
  const alias = String(channel.alias || channel.channel_alias || '').trim();
  if (!alias || alias.toLowerCase() !== String(expectedAlias).trim().toLowerCase()) {
    throw new Error(`Stationhead channel alias mismatch: expected ${expectedAlias}, got ${alias || '(missing)'}`);
  }
  const channelId = nullableNumber(firstDefined(channel.id, channel.channel_id));
  if (channelId === null) throw new Error('Stationhead channel id is missing');

  const station = channel.current_station || {};
  const party = station.streaming_party || channel.streaming_party || {};
  const broadcastHosts = Array.isArray(station.broadcast?.broadcasters)
    ? station.broadcast.broadcasters.filter((value) => (
      value && typeof value === 'object' && !Array.isArray(value) && value.is_host !== false
    ))
    : [];
  const hostSources = [
    station.host,
    channel.host,
    station.current_host,
    channel.current_host,
    station.broadcaster,
    station.dj,
    station.account,
    station.host_account,
    station.owner,
    channel.owner,
    ...broadcastHosts,
  ].filter((value) => value && typeof value === 'object' && !Array.isArray(value));
  const hostIdentities = hostSources.flatMap((value) => {
    const account = value.account;
    return account && typeof account === 'object' && !Array.isArray(account)
      ? [account, value]
      : [value];
  });
  const hostAccountId = nullableNumber(firstDefined(
    ...hostIdentities.flatMap((value) => [value.account_id, value.id]),
  ));
  const hostHandle = normalizedHandle(firstDefined(
    ...hostIdentities.flatMap((value) => [value.handle, value.username]),
    station.host_handle,
    station.host_username,
    channel.host_handle,
  ));
  return {
    channel_id: channelId,
    station_id: nullableNumber(firstDefined(channel.current_station_id, station.id)),
    is_broadcasting: nullableBooleanCode(station.is_broadcasting),
    listener_count: nullableNumber(firstDefined(station.listener_count, channel.listener_count)),
    online_member_count: nullableNumber(channel.online_member_count),
    total_member_count: nullableNumber(channel.total_member_count),
    guest_count: nullableNumber(firstDefined(station.guest_count, channel.guest_count)),
    reported_total_listens: nullableNumber(station.total_listens),
    stream_goal: nullableNumber(party.stream_goal),
    reported_current_stream_count: nullableNumber(party.current_stream_count),
    host_account_id: hostAccountId,
    host_handle: hostHandle,
  };
}

export async function registerOhisamaFollowerTarget(env, snapshot, observedAt) {
  if (snapshot?.is_broadcasting !== 1 || !snapshot?.host_handle) return false;
  if (typeof env?.OTHER_DB?.prepare !== 'function') return false;
  const result = await env.OTHER_DB.prepare(`INSERT INTO sh_stationhead_follower_targets(
      handle,source_mask,first_seen_at,live_confirmed_at
    ) VALUES(?,?,?,?)
    ON CONFLICT(handle) DO UPDATE SET
      source_mask=(sh_stationhead_follower_targets.source_mask | excluded.source_mask),
      live_confirmed_at=COALESCE(sh_stationhead_follower_targets.live_confirmed_at,excluded.live_confirmed_at)
    WHERE (sh_stationhead_follower_targets.source_mask & excluded.source_mask)=0
       OR sh_stationhead_follower_targets.live_confirmed_at IS NULL`)
    .bind(
      snapshot.host_handle,
      STATIONHEAD_FOLLOWER_SOURCE.ohisama,
      observedAt,
      observedAt,
    )
    .run();
  return Number(result?.meta?.changes || 0) > 0;
}
