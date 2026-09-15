import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = name => readFileSync(
  new URL(`../../native/src/${name}`, import.meta.url),
  'utf8',
);

const scripts = source('spotify_static_scripts.inc');
const reconcile = source('spotify_scoped_track_reconcile.inc');
const click = source('spotify_background_click.inc');

test('Spotify page bootstrap injects no lightweight CSS or style overrides', () => {
  assert.doesNotMatch(scripts, /createElement\(['"]style['"]\)/);
  assert.doesNotMatch(scripts, /__homePanelSpotifyStaticLightweight/);
  assert.doesNotMatch(scripts, /!important/);
  assert.doesNotMatch(scripts, /pointer-events\s*:/);
  assert.doesNotMatch(scripts, /content-visibility\s*:/);
});

test('track reconcile uses CDP only for playback start while Pause confirmation may be background-only', () => {
  assert.match(reconcile, /button\[data-testid="play-button"\]/);
  assert.match(reconcile, /button\[data-testid="control-button-playpause"\]/);
  assert.match(reconcile, /pageButtons\.some\(isPauseControl\)/);
  assert.match(reconcile, /playerPause && currentTrackMatchesTarget\(\)/);
  assert.match(reconcile, /return point\(visiblePageButton\)/);
  assert.doesNotMatch(reconcile, /point\(playerPause\)|querySelector\('audio'\)/);
  assert.doesNotMatch(reconcile, /audio\.play\(/);
  assert.doesNotMatch(reconcile, /direct-play|DirectPlay/);
});

test('trusted CDP preflight accepts target Play despite unrelated media and rejects Pause', () => {
  assert.match(click, /const testid=\(\(button\.getAttribute\('data-testid'\)\|\|''\)\.trim\(\)\.toLowerCase\(\)\)/);
  assert.match(
    click,
    /const trustedPlay=testid==='play-button'\|\|testid==='control-button-playpause';/,
  );
  assert.doesNotMatch(click, /document\.querySelectorAll\('audio, video'\)/);
  assert.doesNotMatch(click, /media\.some\(m=>!m\.ended&&!m\.paused\)/);
  assert.match(click, /const label=\(\(button\.getAttribute\('aria-label'\)\|\|button\.getAttribute\('title'\)\|\|''\)\.trim\(\)\.toLowerCase\(\)\)/);
  assert.match(click, /label\.includes\('pause'\)\|\|label\.includes\('一時停止'\)/);
});
