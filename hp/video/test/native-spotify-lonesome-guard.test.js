import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const wrapper = readFileSync(
  new URL('../../native/src/spotify_webviews.inc', import.meta.url), 'utf8');
const scoped = readFileSync(
  new URL('../../native/src/spotify_scoped_track_reconcile.inc', import.meta.url), 'utf8');
const runtime = readFileSync(
  new URL('../../native/src/spotify_media_observer_runtime.inc', import.meta.url), 'utf8');
const events = readFileSync(
  new URL('../../native/src/spotify_media_observer_events.inc', import.meta.url), 'utf8');
const music = readFileSync(
  new URL('../../native/src/spotify_music_target.inc', import.meta.url), 'utf8');
const routing = readFileSync(
  new URL('../../native/src/spotify_target_routing.inc', import.meta.url), 'utf8');
const click = readFileSync(
  new URL('../../native/src/spotify_background_click.inc', import.meta.url), 'utf8');

test('all configured tracks use the shared music descriptor and scoped reconcile implementation', () => {
  assert.match(wrapper, /#include "spotify_scoped_track_reconcile\.inc"/);
  assert.doesNotMatch(wrapper, /spotify_lonesome_guard\.inc|RewriteSpotify|#define ExecuteScript/);
  assert.match(music, /MusicTargetDescriptor SpotifyWebViews::ResolveMusicTarget/);
  assert.match(music, /slot\.timedCycleTracks\[slot\.timedRotationPosition\]/);
  assert.match(routing, /kind = L"music"/);
  assert.match(scoped, /now-playing-widget/);
  assert.match(scoped, /now-playing-bar/);
  assert.match(scoped, /navigator\.mediaSession/);
  assert.match(scoped, /targetMatches\(current\)/);
  assert.match(scoped, /targetPlayButton/);
});

test('track reconcile never forces repeat-one and observer owns near-end completion', () => {
  assert.doesNotMatch(scoped, /repeatState|control-button-repeat|repeatMode/);
  assert.match(runtime, /post\('spotify:timed-started'\)/);
  assert.match(events, /const finishLeadSeconds = 1\.5/);
  assert.match(events, /duration - finishLeadSeconds/);
  assert.match(events, /document\.addEventListener\('ended'/);
  assert.match(events, /post\('spotify:timed-ended'\)/);
});

test('returned Spotify control points flow through the single CDP trusted-click module', () => {
  assert.match(click, /bool SpotifyWebViews::ParseNormalizedPoint/);
  assert.match(click, /void SpotifyWebViews::ClickSlotNormalizedPoint/);
  assert.match(
    click,
    /DispatchSpotifyDevToolsClick\(\s*(?:slot|\*target),\s*xTenThousandths,\s*yTenThousandths\)/,
  );
  assert.match(click, /Input\.dispatchMouseEvent/);
  assert.doesNotMatch(click, /SendInput|MOUSEEVENTF_/);
});

test('wrong queue items are corrected only from the requested track or direct track page', () => {
  assert.match(scoped, /a\[href\*="\/track\/"\]/);
  assert.match(scoped, /tracklist-row/);
  assert.match(scoped, /onTargetPage\(\)/);
  assert.match(scoped, /spotify:not-playing/);
  assert.match(music, /track\.path\.c_str\(\)/);
});
