import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const wrapper = readFileSync(
  new URL('../../native/src/spotify_webviews.inc', import.meta.url),
  'utf8',
);
const scripts = readFileSync(
  new URL('../../native/src/spotify_static_scripts.inc', import.meta.url),
  'utf8',
);
const recent = readFileSync(
  new URL('../../native/src/spotify_recent_catalog.inc', import.meta.url),
  'utf8',
);
const phaseSync = readFileSync(
  new URL('../../native/src/spotify_phase_sync.inc', import.meta.url),
  'utf8',
);
const click = readFileSync(
  new URL('../../native/src/spotify_background_click.inc', import.meta.url),
  'utf8',
);

test('Lonesome rabbit validation is handled by the shared fixed track script', () => {
  assert.match(wrapper, /#include "spotify_static_scripts\.inc"/);
  assert.doesNotMatch(wrapper, /spotify_lonesome_guard\.inc|RewriteSpotify|#define ExecuteScript/);
  assert.match(recent, /TimedSpotifyTarget::LonesomeRabbit/);
  assert.match(recent, /title = kSpotifyLonesomeRabbitTitle/);
  assert.match(recent, /kind = L"music"/);
  assert.match(scripts, /now-playing-widget/);
  assert.match(scripts, /context-item-link/);
  assert.match(scripts, /navigator\.mediaSession/);
  assert.match(scripts, /targetMatches\(current\)/);
  assert.match(scripts, /targetPlayButton/);
});

test('timed music does not install a repeat-one loop that would block A-B-C-D completion', () => {
  assert.doesNotMatch(scripts, /ensureRepeatOne|__homePanelLonesomeRabbitLoop/);
  assert.doesNotMatch(scripts, /repeat\.click\(\)/);
  assert.match(scripts, /kSpotifyStaticEndObserverScript/);
  assert.match(scripts, /media\.addEventListener\('ended'/);
});

test('returned Spotify control points flow through the single CDP trusted-click path', () => {
  assert.match(phaseSync, /ParseNormalizedPoint/);
  assert.match(phaseSync, /DispatchSpotifyDevToolsClick\(slot, xTenThousandths, yTenThousandths\)/);
  assert.match(click, /Input\.dispatchMouseEvent/);
  assert.doesNotMatch(click, /SendInput|MOUSEEVENTF_/);
});

test('wrong queue items are corrected from the requested track or album row', () => {
  assert.match(scripts, /a\[href\*="\/track\/"\]/);
  assert.match(scripts, /tracklist-row/);
  assert.match(scripts, /spotify:not-playing/);
  assert.match(recent, /kSpotifyLonesomeRabbitPath/);
});
