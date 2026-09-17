import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = name => readFileSync(
  new URL(`../../native/src/${name}`, import.meta.url), 'utf8');

const hostWindow = source('renderer_panels/media_host_window.inc');
const schedule = source('spotify_stagger_schedule.inc');
const phase = source('spotify_phase_sync.inc');

test('YouTube panel no longer creates or polls a Spotify status strip', () => {
  assert.doesNotMatch(hostWindow, /HomePanelNativeSpotifyStatus/);
  assert.doesNotMatch(hostWindow, /kNativeSpotifyStatusPollTimer/);
  assert.doesNotMatch(hostWindow, /PollSpotifyPlaybackStatusesNow\(\)/);
  assert.doesNotMatch(hostWindow, /GetSpotifyPlaybackStatuses\(\)/);
  assert.doesNotMatch(schedule, /PollProcessTitleStatus\(now\)/);
  assert.doesNotMatch(phase, /considerTick\(slot\.nextProcessTitlePollTick/);
});

test('YouTube/TVer uses the full media cell after status-strip removal', () => {
  assert.match(hostWindow, /totalHeight \* 16 \/ 9/);
  assert.match(hostWindow, /contentTop/);
  assert.doesNotMatch(hostWindow, /statusHeight|statusBounds|EnsureNativeSpotifyStatusPanel/);
});
