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
const rotation = readFileSync(
  new URL('../../native/src/spotify_timed_end_rotation.inc', import.meta.url), 'utf8');
const routing = readFileSync(
  new URL('../../native/src/spotify_target_routing.inc', import.meta.url), 'utf8');
const click = readFileSync(
  new URL('../../native/src/spotify_background_click.inc', import.meta.url), 'utf8');

test('all configured tracks use the current ManagedTrack and CDP-only scoped reconcile implementation', () => {
  assert.match(wrapper, /#include "spotify_scoped_track_reconcile\.inc"/);
  assert.doesNotMatch(wrapper, /spotify_lonesome_guard\.inc|RewriteSpotify|#define ExecuteScript/);
  assert.match(music, /const SpotifyWebViews::ManagedTrack\* SpotifyWebViews::CurrentMusicTrack/);
  assert.match(music, /slot\.timedCycleTracks\[slot\.timedRotationPosition\]/);
  assert.match(routing, /CurrentMusicTrack\(slot\)/);
  assert.doesNotMatch(routing, /kind = L"music"|trackPath|pagePath/);
  assert.match(scoped, /button\[data-testid="play-button"\]/);
  assert.match(scoped, /button\[data-testid="control-button-playpause"\]/);
  assert.match(scoped, /const pageButtons =/);
  assert.match(scoped, /const visiblePageButton = pageButtons\.find\(visible\)/);
  assert.match(scoped, /pageButtons\.some\(isPauseControl\)/);
  assert.match(scoped, /const playerPause = playerButtons\.find\(isPauseControl\)/);
  assert.match(scoped, /playerPause && currentTrackMatchesTarget\(\)/);
  assert.match(scoped, /return point\(visiblePageButton\)/);
  assert.doesNotMatch(scoped, /point\(playerPause\)|document\.querySelector\('audio'\)|audio\.play\(|direct-play|DirectPlay/);
  assert.match(scoped, /now-playing-widget|now-playing-bar/);
  assert.match(scoped, /navigator\.mediaSession/);
});

test('track reconcile never forces repeat-one and completion remains one native deadline', () => {
  assert.doesNotMatch(scoped, /repeatState|control-button-repeat|repeatMode/);
  assert.match(runtime, /postFields\('spotify:timed-started', String\(remainingMs\)\)/);
  assert.match(events, /addEventListener\('ended', observeEnded, true\)/);
  assert.match(events, /addEventListener\('loadedmetadata', observe, true\)/);
  assert.match(events, /addEventListener\('canplay', observe, true\)/);
  assert.match(events, /addEventListener\('timeupdate', observe, true\)/);
  assert.doesNotMatch(
    events,
    /addEventListener\('(?:seeking|seeked|waiting|stalled|pause)'/,
  );
  assert.match(events, /post\('spotify:timed-ended'\)/);
  assert.match(rotation, /ShortenMusicCompletionDeadlineAtEnd/);
  assert.doesNotMatch(runtime + events, /spotify:timed-plan/);
});

test('returned Spotify CSS control points flow through the single CDP trusted-click module', () => {
  assert.match(click, /bool SpotifyWebViews::ParseCssPoint/);
  assert.match(click, /void SpotifyWebViews::ClickSlotCssPoint/);
  assert.match(
    click,
    /DispatchSpotifyDevToolsClick\(\*target, verifiedX, verifiedY\)/,
  );
  assert.match(click, /const double x = cssX/);
  assert.match(click, /const double y = cssY/);
  assert.match(click, /Input\.dispatchMouseEvent/);
  assert.doesNotMatch(click, /SendInput|MOUSEEVENTF_|get_ZoomFactor|GetDpiForWindow|cssWidth|cssHeight/);
});

test('wrong target URL is corrected only by scheduler-owned target navigation', () => {
  assert.match(music, /if \(!SlotMatchesMusicTarget\(slot\)\) \{\s*NavigateMusicTarget\(slot\);\s*return;/);
  assert.match(scoped, /location\.pathname === targetPath/);
  assert.match(scoped, /location\.pathname\.endsWith\(targetPath\)/);
  assert.match(scoped, /currentTrackMatchesTarget/);
  assert.doesNotMatch(scoped, /tracklist-row|spotify:playing|spotify:not-playing/);
  assert.doesNotMatch(scoped, /NavigateMusicTarget|location\.assign|location\.replace/);
});
