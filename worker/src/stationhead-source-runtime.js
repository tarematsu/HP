import { normalizeStationheadSource } from '../../packages/sh-shared/stationhead-source.mjs';
import { captureBuddiesPlayback } from './buddies-playback-state.js';
import { registerBuddiesInitialFollowerTarget } from './stationhead-initial-followers.js';

export function stationheadPlaybackCapture(sourceValue) {
  return normalizeStationheadSource(sourceValue) === 'buddies' ? captureBuddiesPlayback : null;
}

export function stationheadInitialFollowerRegistrar(sourceValue) {
  return normalizeStationheadSource(sourceValue) === 'buddies' ? registerBuddiesInitialFollowerTarget : null;
}
