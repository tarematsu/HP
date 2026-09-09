import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sourcePart = (name) => readFileSync(
  new URL(`../../native/src/${name}`, import.meta.url), 'utf8');
const spotify = [
  'spotify_webviews.cpp',
  'spotify_webviews_core_part1.inc',
  'spotify_webviews_core_part2.inc',
  'spotify_webviews_core_part3.inc',
  'spotify_webviews_core_part4.inc',
].map(sourcePart).join('\n');
const spotifyHeader = sourcePart('spotify_webviews.h');
const schedule = sourcePart('spotify_stagger_schedule.inc');
const scripts = sourcePart('spotify_static_scripts.inc');
const layout = sourcePart('spotify_host_layout.inc');

test('Spotify WebViews serialize startup without UI-thread blocking or legacy timer rewriting', () => {
  assert.match(spotify, /CreateController\(slots_\[0\]\)/);
  assert.match(schedule, /kSpotifyTimedSlotOffsetMs = 40ULL \* 1000ULL/);
  assert.match(schedule, /accountCount \* kSpotifyTimedSlotOffsetMs/);
  assert.match(schedule, /SimpleSpotifyScheduledIndex\(elapsed, slots_\.size\(\)\)/);
  assert.doesNotMatch(schedule, /% 6ULL|std::min<ULONGLONG>\(5ULL/);
  assert.doesNotMatch(spotify, /kSpotifyStartupTimer|kSpotifyStartupStaggerMs|Sleep\(/);
});

test('all playback controllers keep a stable offscreen viewport while only the recovery owner gets a large viewport', () => {
  assert.match(layout, /slot\.controller->put_IsVisible\(TRUE\)/);
  assert.match(layout, /ShowWindow\(slot\.hostWindow, SW_SHOWNOACTIVATE\)/);
  assert.match(layout, /kSpotifyParkedPlaybackWidth = 320/);
  assert.match(layout, /kSpotifyParkedPlaybackHeight = 180/);
  assert.match(layout, /int width = kSpotifyParkedPlaybackWidth;\s*int height = kSpotifyParkedPlaybackHeight/);
  assert.match(layout, /const bool recovery =\s*i == hostLayoutActiveSlot_ && !authentication &&\s*SlotStateNeedsRecovery\(slot\.state\)/);
  assert.match(layout, /width = std::max\(activeWidth, kSpotifyRecoveryInteractionWidth\)/);
  assert.match(layout, /height = std::max\(activeHeight, kSpotifyRecoveryInteractionHeight\)/);
  assert.doesNotMatch(layout, /const bool active =/);
  assert.doesNotMatch(layout, /int width = 1;\s*int height = 1/);
  assert.doesNotMatch(layout, /SW_HIDE/);
  assert.match(
    layout,
    /if \(batch\) EndDeferWindowPos\(batch\);[\s\S]*GetClientRect\(slot\.hostWindow, &bounds\);[\s\S]*put_Bounds\(bounds\);[\s\S]*NotifyParentWindowPositionChanged\(\)/,
  );
});

test('lightweight Spotify styling is a fixed bootstrap script with no MutationObserver', () => {
  assert.match(scripts, /kSpotifyStaticPageBootstrapScript\[\]/);
  assert.match(scripts, /background-image: none !important/);
  assert.match(scripts, /img, picture, video, canvas/);
  assert.doesNotMatch(scripts, /new\s+MutationObserver\s*\(/);
  assert.doesNotMatch(scripts, /RewriteSpotify|ReplaceSpotifyScriptFragment/);
});

test('Spotify player pages block only images and fonts while auth pages stay unfiltered', () => {
  assert.match(spotify, /COREWEBVIEW2_WEB_RESOURCE_CONTEXT_IMAGE/);
  assert.match(spotify, /COREWEBVIEW2_WEB_RESOURCE_CONTEXT_FONT/);
  assert.match(spotify, /!target->playerPage \|\| !target->environment/);
  assert.match(spotify, /CreateWebResourceResponse\(\s*nullptr, 204, L"No Content"/);
  assert.match(spotify, /remove_WebResourceRequested/);
  assert.match(spotifyHeader, /EventRegistrationToken webResourceRequestedToken/);
  assert.doesNotMatch(spotify, /COREWEBVIEW2_WEB_RESOURCE_CONTEXT_SCRIPT/);
  assert.doesNotMatch(spotify, /COREWEBVIEW2_WEB_RESOURCE_CONTEXT_MEDIA/);
  assert.doesNotMatch(spotify, /COREWEBVIEW2_WEB_RESOURCE_CONTEXT_XML_HTTP_REQUEST/);
});