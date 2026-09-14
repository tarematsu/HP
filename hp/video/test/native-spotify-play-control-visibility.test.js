import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = name => readFileSync(
  new URL(`../../native/src/${name}`, import.meta.url),
  'utf8',
);

const css = source('spotify_static_scripts.inc');
const reconcile = source('spotify_scoped_track_reconcile.inc');
const click = source('spotify_background_click.inc');

test('Spotify lightweight CSS never hides Play/Pause glyphs', () => {
  assert.doesNotMatch(
    css,
    /svg\[aria-hidden='true'\]\s*\{[\s\S]{0,120}display:\s*none\s*!important/,
  );
  assert.match(css, /\[data-testid="play-button"\][\s\S]*visibility: visible !important/);
  assert.match(css, /\[data-testid="control-button-playpause"\][\s\S]*pointer-events: auto !important/);
  assert.match(css, /\[data-testid="play-button"\] svg/);
  assert.match(css, /\[data-testid="control-button-playpause"\] svg/);
});

test('track reconcile accepts Spotify play-button identity even without aria-label', () => {
  assert.match(reconcile, /const testIdOf = element/);
  assert.match(reconcile, /if \(testId === 'play-button'\) return 'play'/);
  assert.match(
    reconcile,
    /pageButtons\.find\(candidate =>\s*visible\(candidate\) && testIdOf\(candidate\) === 'play-button'\)/,
  );
});

test('trusted CDP preflight accepts data-testid play-button without requiring text label', () => {
  assert.match(click, /const testid=\(\(button\.getAttribute\('data-testid'\)\|\|''\)\.trim\(\)\.toLowerCase\(\)\)/);
  assert.match(click, /const trustedPlay=testid==='play-button'\|\|label==='play'/);
  assert.doesNotMatch(click, /if\(!label\|\|label\.includes\('pause'\)/);
  assert.match(click, /if\(label\.includes\('pause'\)\|\|label\.includes\('一時停止'\)\)return false/);
});
