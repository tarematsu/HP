import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const hostWindow = readFileSync(
  new URL('../../native/src/renderer_panels/media_host_window.inc', import.meta.url),
  'utf8',
);

test('YouTube panel no longer polls or renders Stationhead status', () => {
  assert.doesNotMatch(hostWindow, /kNativeStationheadStatusPollTimer/);
  assert.doesNotMatch(hostWindow, /kNativeStationheadStatusPollMs/);
  assert.doesNotMatch(hostWindow, /PollStationheadStatusStripCurrentTrackTitle/);
  assert.doesNotMatch(hostWindow, /StationheadStatusStripCurrentTrackTitle/);
  assert.doesNotMatch(hostWindow, /drawStatusCard\([^\n]*Stationhead/);
});
