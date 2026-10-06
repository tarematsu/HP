import { captureBuddiesPlayback } from './buddies-playback-state.js';
import { registerBuddiesInitialFollowerTarget } from './stationhead-initial-followers.js';

function source(value) {
  return String(value || '').trim().toLowerCase();
}

export function stationheadPlaybackCapture(sourceValue) {
  return source(sourceValue) === 'buddies' ? captureBuddiesPlayback : null;
}

export function stationheadInitialFollowerRegistrar(sourceValue) {
  return source(sourceValue) === 'buddies' ? registerBuddiesInitialFollowerTarget : null;
}
