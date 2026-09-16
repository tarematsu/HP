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
const startupScript = source('sh_startup_script.h');
const compactRuntime = source('sh_compact_runtime_script.h');
const interactionRuntime = source('sh_runtime_interaction_script.h');
const recoveryRuntime = source('sh_runtime_blank_recovery_script.h');
const lifecycleRuntime = source('sh_runtime_lifecycle_script.h');
const nativeCmake = readFileSync(
  new URL('../../native/CMakeLists.txt', import.meta.url),
  'utf8',
);

test('Spotify page bootstrap leaves Spotify rendering and controls completely untouched', () => {
  assert.match(spotify, /kSpotifyStaticPageBootstrapScript/);
  assert.match(spotify, /spotify:target/);
  assert.doesNotMatch(spotify, /createElement\(['"]style['"]\)/);
  assert.doesNotMatch(spotify, /__homePanelSpotifyStaticLightweight/);
  assert.doesNotMatch(spotify, /!important/);
  assert.doesNotMatch(spotify, /animation\s*:|transition\s*:|background-image\s*:/);
  assert.doesNotMatch(spotify, /display\s*:|visibility\s*:|pointer-events\s*:|content-visibility\s*:/);
});

test('Stationhead startup uses the single compact runtime and current render policies', () => {
  assert.match(playbackPolicy, /ApplyStationheadResourceBlockingStartupReduced/);
  assert.doesNotMatch(playbackPolicy, /Network\.clearBrowserCache/);

  assert.match(startupScript, /#include "sh_compact_runtime_script\.h"/);
  assert.match(startupScript, /#include "sh_render_reduction_policy\.h"/);
  assert.match(startupScript, /#include "sh_room_ui_reduction_policy\.h"/);
  assert.match(startupScript, /inline std::wstring BuildStationheadStartupScript\(/);
  assert.match(
    startupScript,
    /StationheadCompactRuntimeScript\(globalName, messagePrefix\)[\s\S]*StationheadRenderReductionScript\(\)[\s\S]*StationheadRoomUiReductionScript\(\)/,
  );
  assert.match(startupScript, /script\.append\(L";\\n"\)/);
  assert.match(
    startupScript,
    /#undef StationheadAutoplayScript[\s\S]*#define StationheadAutoplayScript BuildStationheadStartupScript/,
  );
  assert.match(
    nativeCmake,
    /src\/sh_track_boundary_message_policy\.h[\s\S]*src\/sh_startup_script\.h/,
  );

  for (const retired of [
    'src/sh_runtime_policy_fix.h',
    'src/sh_runtime_lifecycle_policy_fix.h',
    'src/sh_runtime_recovery_polling_policy_fix.h',
    'src/sh_media_stall_watchdog_policy_fix.h',
  ]) assert.doesNotMatch(nativeCmake, new RegExp(retired.replaceAll('.', '\\.')));
});

test('compact Stationhead runtime has one event-driven lifecycle and bounded recovery', () => {
  assert.match(compactRuntime, /StationheadRuntimeInteractionFragment\(\)/);
  assert.match(compactRuntime, /StationheadRuntimeBlankRecoveryFragment\(\)/);
  assert.match(compactRuntime, /StationheadRuntimeLifecycleFragment\(\)/);
  assert.match(compactRuntime, /StationheadAutoplayScriptRuntimeFixed/);

  const runtime = interactionRuntime + recoveryRuntime + lifecycleRuntime;
  assert.doesNotMatch(runtime, /setInterval\s*\(/);
  assert.doesNotMatch(runtime, /new\s+MutationObserver/);
  assert.doesNotMatch(runtime, /timeupdate/);
  assert.match(recoveryRuntime, /30000/);
  assert.match(recoveryRuntime, /15000/);
  assert.match(lifecycleRuntime, /'play', 'playing', 'canplay', 'pause', 'ended', 'stalled', 'waiting', 'error'/);
});

test('Stationhead render policy reduces paint work without hiding controls', () => {
  assert.match(renderPolicy, /__homepanelStationheadRenderReduction/);
  assert.match(renderPolicy, /animation: none !important/);
  assert.match(renderPolicy, /animation-play-state: paused !important/);
  assert.match(renderPolicy, /transition: none !important/);
  assert.match(renderPolicy, /view-transition-name: none !important/);
  assert.match(renderPolicy, /picture, img,[\s\S]*video, canvas, svg\[aria-hidden='true'\]/);
  assert.match(renderPolicy, /content-visibility: hidden !important/);
  assert.match(renderPolicy, /contain: strict !important/);
  assert.doesNotMatch(renderPolicy, /^\s*button\s*[,}]/m);
  assert.doesNotMatch(renderPolicy, /^\s*input\s*[,}]/m);
  assert.doesNotMatch(renderPolicy, /HTMLMediaElement|\.pause\(\)/);
});

test('Stationhead room becomes playback-only without recurring polling', () => {
  assert.match(roomUiPolicy, /__homepanelStationheadRoomUiReduction/);
  assert.match(roomUiPolicy, /singleSegmentRoom/);
  assert.match(roomUiPolicy, /channelRoom/);
  assert.match(roomUiPolicy, /parts\[0\]\.toLowerCase\(\) === 'c'/);
  assert.match(roomUiPolicy, /data-homepanel-stationhead-playback-only/);
  assert.match(roomUiPolicy, /document\.addEventListener\('playing', onMediaState, true\)/);
  assert.match(roomUiPolicy, /'pause', 'waiting', 'stalled', 'ended', 'error', 'emptied', 'abort'/);
  assert.match(roomUiPolicy, /body > :not\(script\):not\(style\)/);
  assert.match(roomUiPolicy, /content-visibility: hidden !important/);
  assert.match(roomUiPolicy, /contain: strict !important/);
  assert.doesNotMatch(roomUiPolicy, /setInterval\s*\(/);
  assert.doesNotMatch(roomUiPolicy, /requestAnimationFrame/);
  assert.doesNotMatch(roomUiPolicy, /HTMLMediaElement|\.pause\(\)/);
});
