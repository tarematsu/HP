import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = name => readFileSync(
  new URL(`../../native/src/${name}`, import.meta.url), 'utf8');

const spotify = source('spotify_static_scripts.inc');
const playback = source('sh_playback_resource_policy_fix.h');
const startup = source('sh_startup_script.h');
const compact = source('sh_compact_runtime_script.h');
const interaction = source('sh_runtime_interaction_script.h');
const recovery = source('sh_runtime_blank_recovery_script.h');
const lifecycle = source('sh_runtime_lifecycle_script.h');
const render = source('sh_render_reduction_policy.h');
const room = source('sh_room_ui_reduction_policy.h');
const profileEnd = source('sh_profile_reuse_policy_end.h');

const runtime = interaction + recovery + lifecycle;

test('Spotify keeps static paint reduction without hiding playback controls', () => {
  assert.match(spotify, /__homePanelSpotifyStaticLightweight/);
  assert.match(spotify, /animation: none !important/);
  assert.match(spotify, /background-image: none !important/);
  assert.match(spotify, /\[data-testid="play-button"\] svg/);
  assert.match(spotify, /\[data-testid="control-button-playpause"\] svg/);
});

test('Stationhead startup header owns composition only', () => {
  assert.match(playback, /ApplyStationheadResourceBlockingStartupReduced/);
  assert.doesNotMatch(playback, /Network\.clearBrowserCache/);

  assert.match(startup, /#include "sh_compact_runtime_script\.h"/);
  assert.match(startup, /inline std::wstring BuildStationheadStartupScript\(/);
  assert.match(
    startup,
    /StationheadCompactRuntimeScript\(globalName, messagePrefix\)[\s\S]*StationheadRenderReductionScript\(\)[\s\S]*StationheadRoomUiReductionScript\(\)/,
  );
  assert.doesNotMatch(startup, /querySelectorAll|setTimeout|setInterval|MutationObserver/);
  assert.match(
    startup,
    /#undef StationheadAutoplayScript[\s\S]*#define StationheadAutoplayScript BuildStationheadStartupScript/,
  );
  assert.match(profileEnd, /#include "sh_startup_script\.h"/);
});

test('compact runtime composes one interaction, recovery and lifecycle script', () => {
  assert.match(compact, /#include "sh_runtime_interaction_script\.h"/);
  assert.match(compact, /#include "sh_runtime_blank_recovery_script\.h"/);
  assert.match(compact, /#include "sh_runtime_lifecycle_script\.h"/);
  assert.match(compact, /StationheadRuntimeInteractionFragment\(\)/);
  assert.match(compact, /StationheadRuntimeBlankRecoveryFragment\(\)/);
  assert.match(compact, /StationheadRuntimeLifecycleFragment\(\)/);
  assert.match(compact, /script\.reserve\(interaction\.size\(\) \+ recovery\.size\(\) \+ lifecycle\.size\(\) \+ 2\)/);
  assert.doesNotMatch(compact, /querySelectorAll|setTimeout|setInterval|MutationObserver/);

  assert.match(interaction, /StationheadRuntimeInteractionFragment/);
  assert.match(recovery, /StationheadRuntimeBlankRecoveryFragment/);
  assert.match(lifecycle, /StationheadRuntimeLifecycleFragment/);
  assert.doesNotMatch(runtime, /setInterval\s*\(|new\s+MutationObserver|requestAnimationFrame/);
});

test('Stationhead generic rendering reduction is CSS-only', () => {
  assert.match(render, /__homepanelStationheadRenderReduction/);
  assert.match(render, /animation: none !important/);
  assert.match(render, /transition: none !important/);
  assert.match(render, /view-transition-name: none !important/);
  assert.match(render, /content-visibility: hidden !important/);
  assert.doesNotMatch(render, /new\s+MutationObserver/);
  assert.doesNotMatch(render, /setInterval\s*\(/);
  assert.doesNotMatch(render, /requestAnimationFrame/);
  assert.doesNotMatch(render, /^\s*button\s*[,}]/m);
  assert.doesNotMatch(render, /^\s*input\s*[,}]/m);
});

test('Stationhead room reduction uses audited static selectors only', () => {
  for (const pattern of [
    /class~='button--full-width'/,
    /aria-label='Open threads'/,
    /href\$='\/threads'/,
    /aria-label='View streaming party details'/,
    /aria-label='Toggle Mute'/,
    /aria-label='Volume'/,
    /aria-label\^='Reply to '/,
    /aside:has\(textarea/,
  ]) assert.match(room, pattern);

  assert.doesNotMatch(room, /querySelectorAll|getBoundingClientRect|innerText/);
  assert.doesNotMatch(room, /setTimeout\s*\(|setInterval\s*\(|new\s+MutationObserver/);
  assert.doesNotMatch(room, /requestAnimationFrame|HTMLMediaElement|\.pause\(\)/);
  assert.doesNotMatch(room, /start listening|connect spotify|log in/i);
});
