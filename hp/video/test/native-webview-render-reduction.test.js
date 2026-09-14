import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = name => readFileSync(
  new URL(`../../native/src/${name}`, import.meta.url),
  'utf8',
);
const spotify = source('spotify_static_scripts.inc');
const playbackPolicy = source('sh_playback_resource_policy_fix.h');
const renderPolicy = source('sh_render_reduction_policy.h');
const roomUiPolicy = source('sh_room_ui_reduction_policy.h');
const presentationPolicy = source('sh_presentation_registration_policy.h');
const profileReuseEnd = source('sh_profile_reuse_policy_end.h');
const interactionPolicy = source('sh_track_boundary_message_policy.h');
const nativeCmake = readFileSync(
  new URL('../../native/CMakeLists.txt', import.meta.url),
  'utf8',
);

test('Spotify suppresses paint-only media and visual effects without hiding control SVGs', () => {
  assert.match(spotify, /__homePanelSpotifyStaticLightweight/);
  assert.match(spotify, /animation: none !important/);
  assert.match(spotify, /background-image: none !important/);
  assert.match(spotify, /text-shadow: none !important/);
  assert.match(spotify, /will-change: auto !important/);
  assert.match(spotify, /img, picture, video, canvas\s*\{[\s\S]*display: none !important/);
  assert.doesNotMatch(
    spotify,
    /svg\[aria-hidden='true'\]\s*\{[\s\S]{0,120}display: none !important/,
  );
  assert.match(spotify, /\[data-testid="play-button"\] svg/);
  assert.match(spotify, /\[data-testid="control-button-playpause"\] svg/);
});

test('Stationhead presentation is registered after the final autoplay policy', () => {
  // Playback/data policy must not own presentation composition. Its old macro
  // wrapper could be replaced by later lifecycle/recovery/interaction layers.
  assert.doesNotMatch(playbackPolicy, /sh_render_reduction_policy/);
  assert.doesNotMatch(playbackPolicy, /sh_room_ui_reduction_policy/);
  assert.doesNotMatch(playbackPolicy, /StationheadAutoplayScriptRenderReduced/);
  assert.doesNotMatch(playbackPolicy, /#define StationheadAutoplayScript/);

  assert.match(presentationPolicy, /#include "sh_render_reduction_policy\.h"/);
  assert.match(presentationPolicy, /#include "sh_room_ui_reduction_policy\.h"/);
  assert.match(
    presentationPolicy,
    /StationheadAutoplayScript\(globalName, messagePrefix\)[\s\S]*StationheadRenderReductionScript\(\)[\s\S]*StationheadRoomUiReductionScript\(\)/,
  );
  assert.match(
    presentationPolicy,
    /#undef StationheadAutoplayScript[\s\S]*#define StationheadAutoplayScript StationheadAutoplayScriptPresentationReduced/,
  );

  // Current-interaction is the final behavioral autoplay layer. The PCH end
  // boundary must include presentation strictly after it.
  assert.match(
    interactionPolicy,
    /#define StationheadAutoplayScript StationheadAutoplayScriptCurrentInteraction/,
  );
  assert.match(
    profileReuseEnd,
    /#undef autoClickInFlight_[\s\S]*#include "sh_presentation_registration_policy\.h"/,
  );
  const interactionAt = nativeCmake.indexOf('src/sh_track_boundary_message_policy.h');
  const endAt = nativeCmake.indexOf('src/sh_profile_reuse_policy_end.h');
  assert.ok(interactionAt >= 0);
  assert.ok(endAt > interactionAt);

  assert.doesNotMatch(presentationPolicy, /Toggle Mute|View streaming party details|content-visibility/);
  assert.doesNotMatch(renderPolicy, /Toggle Mute|View streaming party details|button--full-width/);
  assert.doesNotMatch(roomUiPolicy, /Network\.clearBrowserCache|streakStats/);
});

test('Stationhead render policy reduces paint work without hiding all controls', () => {
  assert.match(renderPolicy, /__homepanelStationheadRenderReduction/);
  assert.match(renderPolicy, /animation: none !important/);
  assert.match(renderPolicy, /transition: none !important/);
  assert.match(renderPolicy, /view-transition-name: none !important/);
  assert.match(renderPolicy, /video, canvas, svg\[aria-hidden='true'\]/);
  assert.doesNotMatch(renderPolicy, /^\s*button\s*[,}]/m);
  assert.doesNotMatch(renderPolicy, /^\s*input\s*[,}]/m);
  assert.doesNotMatch(renderPolicy, /img, picture/);
  assert.doesNotMatch(renderPolicy, /background-image: none/);
  assert.doesNotMatch(renderPolicy, /MutationObserver/);
  assert.doesNotMatch(renderPolicy, /setInterval\s*\(/);
  assert.doesNotMatch(renderPolicy, /requestAnimationFrame\s*=/);
  assert.doesNotMatch(renderPolicy, /cancelAnimationFrame\s*=/);
  assert.doesNotMatch(renderPolicy, /HTMLMediaElement|\.pause\(\)/);
});

test('Stationhead render policy hides generic social and decorative UI', () => {
  for (const token of [
    'chat',
    'comment',
    'gift',
    'reaction',
    'emoji',
    'tip',
    'tipping',
    'share',
    'invite',
    'social',
    'listener',
    'audience',
    'leaderboard',
    'ranking',
    'stats',
    'streak',
    'play-count',
    'total-plays',
    'now-playing',
    'track-card',
    'current-track',
    'current-song',
    'song-card',
    'waveform',
    'visualizer',
    'equalizer',
    'spectrum',
    'lottie',
    'confetti',
    'sparkle',
    'marquee',
    'ticker',
  ]) {
    assert.match(renderPolicy, new RegExp(`data-testid\\*='${token}'`));
  }
  assert.match(renderPolicy, /aria-label\*='total plays'/);
  assert.match(renderPolicy, /class\*='chat'/);
  assert.match(renderPolicy, /class\*='thread'/);
  assert.match(renderPolicy, /class\*='waveform'/);
  assert.match(renderPolicy, /class\*='lottie'/);
  assert.match(renderPolicy, /a\[href\*='\/chat'/);
  assert.match(renderPolicy, /content-visibility: hidden !important/);
});

test('Stationhead room UI uses audited static selectors instead of semantic polling', () => {
  assert.match(roomUiPolicy, /__homepanelStationheadRoomUiReduction/);
  assert.match(roomUiPolicy, /parts\.length !== 1/);
  assert.match(roomUiPolicy, /'home', 'sign-in', 'sign-up'/);

  for (const contract of [
    /class~='button--full-width'/,
    /class~='button--md'/,
    /class~='h-12'/,
    /class~='justify-between'/,
    /aria-label='Open threads'/,
    /href\$='\/threads'/,
    /aria-label='View streaming party details'/,
    /aria-label='Copy link'/,
    /aria-label='Toggle Mute'/,
    /aria-label='Volume'/,
    /aria-label\^='View '/,
    /aria-label\^='Reply to '/,
    /class~='resize-none'/,
    /class~='bg-transparent'/,
    /aside:has\(textarea/,
    /\[role='complementary'\]:has\(textarea/,
  ]) {
    assert.match(roomUiPolicy, contract);
  }

  assert.doesNotMatch(roomUiPolicy, /querySelectorAll/);
  assert.doesNotMatch(roomUiPolicy, /getBoundingClientRect/);
  assert.doesNotMatch(roomUiPolicy, /innerText/);
  assert.equal((roomUiPolicy.match(/textContent/g) ?? []).length, 1);
  assert.doesNotMatch(roomUiPolicy, /setTimeout\s*\(/);
  assert.doesNotMatch(roomUiPolicy, /setInterval\s*\(/);
  assert.doesNotMatch(roomUiPolicy, /MutationObserver/);
  assert.doesNotMatch(roomUiPolicy, /requestAnimationFrame/);
  assert.doesNotMatch(roomUiPolicy, /HTMLMediaElement|\.pause\(\)/);
  assert.doesNotMatch(roomUiPolicy, /start listening|connect spotify|log in/i);
});
