import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = name => readFileSync(
  new URL(`../../native/src/${name}`, import.meta.url), 'utf8');

const spotify = source('spotify_static_scripts.inc');
const playback = source('sh_playback_resource_policy_fix.h');
const startup = source('sh_startup_script.h');
const render = source('sh_render_reduction_policy.h');
const room = source('sh_room_ui_reduction_policy.h');
const profileEnd = source('sh_profile_reuse_policy_end.h');


test('Spotify keeps static paint reduction without hiding playback controls', () => {
  assert.match(spotify, /__homePanelSpotifyStaticLightweight/);
  assert.match(spotify, /animation: none !important/);
  assert.match(spotify, /background-image: none !important/);
  assert.match(spotify, /\[data-testid="play-button"\] svg/);
  assert.match(spotify, /\[data-testid="control-button-playpause"\] svg/);
});

test('Stationhead has one explicit compact startup composition', () => {
  assert.match(playback, /ApplyStationheadResourceBlockingStartupReduced/);
  assert.doesNotMatch(playback, /Network\.clearBrowserCache/);

  assert.match(startup, /inline std::wstring StationheadCompactRuntimeScript\(/);
  assert.match(startup, /inline std::wstring BuildStationheadStartupScript\(/);
  assert.match(
    startup,
    /StationheadCompactRuntimeScript\(globalName, messagePrefix\)[\s\S]*StationheadRenderReductionScript\(\)[\s\S]*StationheadRoomUiReductionScript\(\)/,
  );
  assert.doesNotMatch(startup, /StationheadAutoplayScriptCurrentInteraction/);
  assert.doesNotMatch(startup, /new\s+MutationObserver/);
  assert.doesNotMatch(startup, /setInterval\s*\(/);
  assert.doesNotMatch(startup, /requestAnimationFrame/);
  assert.match(
    startup,
    /#undef StationheadAutoplayScript[\s\S]*#define StationheadAutoplayScript BuildStationheadStartupScript/,
  );
  assert.match(profileEnd, /#include "sh_startup_script\.h"/);
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
