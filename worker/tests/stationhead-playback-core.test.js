import assert from 'node:assert/strict';
import test from 'node:test';

import {
  transitionedStationheadTracks,
} from '../src/stationhead-playback-core.js';

function track(eventKey, trackKey, expectedStartAt) {
  return {
    event_key: eventKey,
    track_key: trackKey,
    expected_start_at: expectedStartAt,
  };
}

test('shared playback transition keeps exact overlap behavior used by Buddies', () => {
  const previous = [
    track('q:0', 'a', 1_000),
    track('q:1', 'b', 181_000),
    track('q:2', 'c', 361_000),
  ];
  const current = [
    track('q:2', 'c', 361_000),
    track('q:3', 'd', 541_000),
  ];
  assert.deepEqual(
    transitionedStationheadTracks(previous, current).map((row) => row.track_key),
    ['b', 'c'],
  );
});

test('shared playback transition infers due intermediate tracks across a queue generation change', () => {
  const previous = [
    track('old:0', 'a', 1_000),
    track('old:1', 'b', 181_000),
    track('old:2', 'c', 361_000),
    track('old:3', 'd', 541_000),
  ];
  const current = [track('new:0', 'x', 391_000)];
  const transitioned = transitionedStationheadTracks(previous, current, {
    previousObservedAt: 31_000,
    observedAt: 391_000,
  });
  assert.deepEqual(transitioned.map((row) => row.track_key), ['b', 'c', 'x']);
});

test('shared playback transition does not fabricate elapsed tracks while paused', () => {
  const previous = [
    track('old:0', 'a', 1_000),
    track('old:1', 'b', 181_000),
  ];
  const current = [track('new:0', 'x', 391_000)];
  const transitioned = transitionedStationheadTracks(previous, current, {
    previousObservedAt: 31_000,
    observedAt: 391_000,
    previousPaused: true,
  });
  assert.deepEqual(transitioned.map((row) => row.track_key), ['x']);
});
