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

test('track reconcile finds Spotify Play controls directly by test id without aria-label parsing', () => {
  assert.match(reconcile, /button\[data-testid="play-button"\]/);
  assert.match(reconcile, /button\[data-testid="control-button-playpause"\]/);
  assert.match(reconcile, /\.find\(visible\) \|\| null/);
  assert.doesNotMatch(reconcile, /testIdOf|aria-label|buttonIntent|labelOf/);
});

test('trusted CDP preflight accepts only Spotify Play controls by test id without text labels', () => {
  assert.match(click, /const testid=\(\(button\.getAttribute\('data-testid'\)\|\|''\)\.trim\(\)\.toLowerCase\(\)\)/);
  assert.match(
    click,
    /const trustedPlay=testid==='play-button'\|\|testid==='control-button-playpause';/,
  );
  assert.doesNotMatch(click, /const label=|label\.includes|label==='play'|label==='再生'|一時停止/);
  assert.match(click, /media\.some\(m=>!m\.ended&&!m\.paused\)\)return false/);
});
