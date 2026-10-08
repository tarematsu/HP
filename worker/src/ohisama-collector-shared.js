import { stationheadFiveMinuteBucket } from '../../packages/sh-shared/stationhead-read-models.mjs';
import { OHISAMA_CRON } from './scheduled-crons.js';
import { STATIONHEAD_FOLLOWER_SOURCE } from './stationhead-follower-membership.js';
import { registerStationheadFollowerTarget } from './stationhead-follower-target.js';
import { compactStationheadSnapshot } from './stationhead-collector-core.js';

export const OHISAMA_COLLECTOR_CRON = OHISAMA_CRON;

export function fiveMinuteBucket(timestamp) {
  const bucket = stationheadFiveMinuteBucket(timestamp);
  if (bucket == null || Number(timestamp) < 0) throw new Error('invalid observation timestamp');
  return bucket;
}

export function normalizeOhisamaSnapshot(channel, expectedAlias = 'ohisama') {
  return compactStationheadSnapshot(channel, expectedAlias);
}

export function registerOhisamaFollowerTarget(env, snapshot, observedAt) {
  return registerStationheadFollowerTarget(
    env,
    snapshot,
    observedAt,
    STATIONHEAD_FOLLOWER_SOURCE.ohisama,
  );
}
