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

test('track reconcile prioritizes the target-page Play control before media state', () => {
  assert.match(reconcile, /button\[data-testid="play-button"\]/);
  assert.match(reconcile, /button\[data-testid="control-button-playpause"\]/);
  assert.match(reconcile, /const labelOf = element =>/);
  assert.match(reconcile, /label\.includes\('pause'\) \|\| label\.includes\('一時停止'\)/);
  assert.match(reconcile, /if \(pagePlay\) \{[\s\S]*isPauseControl\(pagePlay\)[\s\S]*return point\(pagePlay\)/);
  const targetControl = reconcile.indexOf('const pagePlay');
  const audio = reconcile.indexOf("const audio = document.querySelector('audio')");
  assert.ok(targetControl >= 0 && audio > targetControl);
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
