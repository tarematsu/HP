import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const spotify = readFileSync(
  new URL('../../native/src/spotify_static_scripts.inc', import.meta.url),
  'utf8',
);
const stationhead = readFileSync(
  new URL('../../native/src/sh_playback_resource_policy_fix.h', import.meta.url),
  'utf8',
);

test('Spotify suppresses paint-only media and visual effects', () => {
  assert.match(spotify, /__homePanelSpotifyStaticLightweight/);
  assert.match(spotify, /animation: none !important/);
  assert.match(spotify, /background-image: none !important/);
  assert.match(spotify, /text-shadow: none !important/);
  assert.match(spotify, /will-change: auto !important/);
  assert.match(spotify, /img, picture, video, canvas,[\s\S]*svg\[aria-hidden='true'\]/);
});

test('Stationhead reduces paint work without hiding auth/start controls', () => {
  assert.match(stationhead, /__homepanelStationheadRenderReduction/);
  assert.match(stationhead, /__homepanelStationheadPruned/);
  assert.match(stationhead, /animation: none !important/);
  assert.match(stationhead, /transition: none !important/);
  assert.match(stationhead, /view-transition-name: none !important/);
  assert.match(stationhead, /video, canvas, svg\[aria-hidden='true'\]/);
  assert.match(
    stationhead,
    /StationheadAutoplayScript\(globalName, messagePrefix\) \+ L"\\n" \+[\s\S]*StationheadRenderReductionScript\(\)/,
  );

  const renderScript = stationhead.slice(
    stationhead.indexOf('inline std::wstring StationheadRenderReductionScript'),
    stationhead.indexOf('inline std::wstring StationheadAutoplayScriptRenderReduced'),
  );
  assert.doesNotMatch(renderScript, /^\s*button\s*[,}]/m);
  assert.doesNotMatch(renderScript, /^\s*input\s*[,}]/m);
  assert.doesNotMatch(renderScript, /img, picture/);
  assert.doesNotMatch(renderScript, /background-image: none/);
  assert.doesNotMatch(renderScript, /MutationObserver/);
  assert.doesNotMatch(renderScript, /setInterval\s*\(/);
  assert.doesNotMatch(renderScript, /requestAnimationFrame\s*=/);
  assert.doesNotMatch(renderScript, /cancelAnimationFrame\s*=/);
  assert.doesNotMatch(renderScript, /HTMLMediaElement|\.pause\(\)/);
  assert.match(renderScript, /start listening/);
  assert.match(renderScript, /connect spotify/);
  assert.match(renderScript, /hasProtectedControl/);
});

test('Stationhead hides social, decorative and presentation-only UI', () => {
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
    assert.match(stationhead, new RegExp(`data-testid\\*='${token}'`));
  }
  assert.match(stationhead, /aria-label\*='total plays'/);
  assert.match(stationhead, /class\*='chat'/);
  assert.match(stationhead, /class\*='thread'/);
  assert.match(stationhead, /class\*='waveform'/);
  assert.match(stationhead, /class\*='lottie'/);
  assert.match(stationhead, /a\[href\*='\/chat'/);
  assert.match(stationhead, /content-visibility: hidden !important/);
});

test('Stationhead prunes unlabeled production UI with bounded startup passes', () => {
  for (const label of [
    'threads',
    'following',
    'request song',
    'ask to speak',
    'get the app',
    'all access',
  ]) {
    assert.match(stationhead, new RegExp(`'${label}'`));
  }
  assert.match(stationhead, /send a message/);
  assert.match(stationhead, /i'm on stationhead/);
  assert.match(stationhead, /syndicating on/);
  assert.match(stationhead, /document\.querySelectorAll\('header,footer'\)/);
  assert.match(stationhead, /\[0, 500, 1500, 4000, 8000, 15000\]/);
  assert.match(stationhead, /setTimeout\(prune, delay\)/);
});
