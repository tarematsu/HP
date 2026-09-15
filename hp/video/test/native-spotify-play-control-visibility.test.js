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

test('track reconcile accepts Spotify Play controls by test id without aria-label', () => {
  assert.match(reconcile, /const testIdOf = element/);
  assert.match(
    reconcile,
    /testId === 'play-button' \|\| testId === 'control-button-playpause'/,
  );
  assert.match(
    reconcile,
    /button\[data-testid="control-button-playpause"\]/,
  );
});

test('trusted CDP preflight accepts Spotify Play controls by test id without text label', () => {
  assert.match(click, /const testid=\(\(button\.getAttribute\('data-testid'\)\|\|''\)\.trim\(\)\.toLowerCase\(\)\)/);
  assert.match(
    click,
    /const trustedPlay=testid==='play-button'\|\|testid==='control-button-playpause'\|\|label==='play'/,
  );
  assert.doesNotMatch(click, /if\(!label\|\|label\.includes\('pause'\)/);
  assert.match(click, /if\(label\.includes\('pause'\)\|\|label\.includes\('一時停止'\)\)return false/);
});
