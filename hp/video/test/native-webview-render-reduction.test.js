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
const minimalUiPolicy = source('sh_minimal_ui_policy.h');

test('Spotify suppresses paint-only media and visual effects', () => {
  assert.match(spotify, /__homePanelSpotifyStaticLightweight/);
  assert.match(spotify, /animation: none !important/);
  assert.match(spotify, /background-image: none !important/);
  assert.match(spotify, /text-shadow: none !important/);
  assert.match(spotify, /will-change: auto !important/);
  assert.match(spotify, /img, picture, video, canvas,[\s\S]*svg\[aria-hidden='true'\]/);
});

test('Stationhead presentation policies stay split by responsibility', () => {
  assert.match(playbackPolicy, /#include "sh_render_reduction_policy\.h"/);
  assert.match(playbackPolicy, /#include "sh_minimal_ui_policy\.h"/);
  assert.match(
    playbackPolicy,
    /StationheadAutoplayScript\(globalName, messagePrefix\)[\s\S]*StationheadRenderReductionScript\(\)[\s\S]*StationheadMinimalUiPruningScript\(\)/,
  );

  assert.doesNotMatch(playbackPolicy, /send a message|request song|content-visibility/);
  assert.doesNotMatch(renderPolicy, /send a message|request song|setTimeout\(prune/);
  assert.doesNotMatch(minimalUiPolicy, /Network\.clearBrowserCache|streakStats/);
});

test('Stationhead render policy reduces paint work without hiding all controls', () => {
  assert.match(renderPolicy, /__homepanelStationheadRenderReduction/);
  assert.match(renderPolicy, /__homepanelStationheadPruned/);
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

test('Stationhead render policy hides social, decorative and presentation-only UI', () => {
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

test('Stationhead semantic UI pruning protects auth/start and uses bounded startup passes', () => {
  for (const label of [
    'threads',
    'following',
    'request song',
    'ask to speak',
    'get the app',
    'all access',
  ]) {
    assert.match(minimalUiPolicy, new RegExp(`'${label}'`));
  }
  assert.match(minimalUiPolicy, /start listening/);
  assert.match(minimalUiPolicy, /connect spotify/);
  assert.match(minimalUiPolicy, /hasProtectedControl/);
  assert.match(minimalUiPolicy, /send a message/);
  assert.match(minimalUiPolicy, /i'm on stationhead/);
  assert.match(minimalUiPolicy, /syndicating on/);
  assert.match(minimalUiPolicy, /document\.querySelectorAll\('header,footer'\)/);
  assert.match(minimalUiPolicy, /\[0, 500, 1500, 4000, 8000, 15000\]/);
  assert.match(minimalUiPolicy, /setTimeout\(prune, delay\)/);
  assert.doesNotMatch(minimalUiPolicy, /MutationObserver/);
  assert.doesNotMatch(minimalUiPolicy, /setInterval\s*\(/);
  assert.doesNotMatch(minimalUiPolicy, /requestAnimationFrame\s*=/);
  assert.doesNotMatch(minimalUiPolicy, /HTMLMediaElement|\.pause\(\)/);
});
