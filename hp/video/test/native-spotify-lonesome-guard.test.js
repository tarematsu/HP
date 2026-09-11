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
const recent = readFileSync(
  new URL('../../native/src/spotify_recent_catalog.inc', import.meta.url), 'utf8');
const click = readFileSync(
  new URL('../../native/src/spotify_background_click.inc', import.meta.url), 'utf8');

test('all configured tracks use the shared music descriptor and scoped reconcile implementation', () => {
  assert.match(wrapper, /#include "spotify_scoped_track_reconcile\.inc"/);
  assert.doesNotMatch(wrapper, /spotify_lonesome_guard\.inc|RewriteSpotify|#define ExecuteScript/);
  assert.match(recent, /MusicTargetDescriptor SpotifyWebViews::ResolveMusicTarget/);
  assert.match(recent, /slot\.timedCycleTracks\[slot\.timedRotationPosition\]/);
  assert.match(recent, /kind = L"music"/);
  assert.match(scoped, /now-playing-widget/);
  assert.match(scoped, /now-playing-bar/);
  assert.match(scoped, /navigator\.mediaSession/);
  assert.match(scoped, /targetMatches\(current\)/);
  assert.match(scoped, /targetPlayButton/);
});

test('music forces Spotify shuffle off before repeat-one reconciliation', () => {
  assert.match(scoped, /const shuffleState = button =>/);
  assert.match(scoped, /button\[data-testid="control-button-shuffle"\]/);
  assert.match(scoped, /checked === 'true'.*'on'/s);
  assert.match(scoped, /checked === 'false'.*'off'/s);
  assert.match(scoped, /shuffleMode === 'on'/);
  assert.match(scoped, /return point\(shuffle\)/);
  assert.match(
    scoped,
    /control-button-shuffle[\s\S]*shuffleMode === 'on'[\s\S]*control-button-repeat/,
  );
});

test('music keeps Spotify repeat-one as a queue fail-safe while observer owns natural completion', () => {
  assert.match(scoped, /const repeatState = button =>/);
  assert.match(scoped, /button\[data-testid="control-button-repeat"\]/);
  assert.match(scoped, /checked === 'false'.*'off'/s);
  assert.match(scoped, /checked === 'true'.*'context'/s);
  assert.match(scoped, /checked === 'mixed'.*'one'/s);
  assert.match(scoped, /repeatMode !== 'one' && repeatMode !== 'unknown'/);
  assert.match(scoped, /return point\(repeat\)/);
  assert.doesNotMatch(scoped, /repeat\.click\(\)/);
  assert.match(runtime, /post\('spotify:timed-started'\)/);
  assert.match(events, /document\.addEventListener\('ended'/);
  assert.match(events, /post\('spotify:timed-ended'\)/);
  assert.doesNotMatch(events, /finishLeadSeconds|duration - finishLeadSeconds/);
});

test('returned Spotify control points flow through the single CDP trusted-click module', () => {
  assert.match(click, /bool SpotifyWebViews::ParseNormalizedPoint/);
  assert.match(click, /void SpotifyWebViews::ClickSlotNormalizedPoint/);
  assert.match(click, /DispatchSpotifyDevToolsClick\(slot, xTenThousandths, yTenThousandths\)/);
  assert.match(click, /Input\.dispatchMouseEvent/);
  assert.doesNotMatch(click, /SendInput|MOUSEEVENTF_/);
});

test('wrong queue items are corrected only from the requested track or direct track page', () => {
  assert.match(scoped, /a\[href\*="\/track\/"\]/);
  assert.match(scoped, /tracklist-row/);
  assert.match(scoped, /onTargetPage\(\)/);
  assert.match(scoped, /spotify:not-playing/);
  assert.match(recent, /track\.path\.c_str\(\)/);
});
