import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = name => readFileSync(
  new URL(`../../native/src/${name}`, import.meta.url), 'utf8');

const runtime = source('spotify_media_observer_runtime.inc');
const click = source('spotify_background_click.inc');

test('music play preflight arms trusted start before native click dispatch', () => {
  const generation = click.indexOf(
    'const ULONGLONG targetGeneration = slot.targetGeneration;',
  );
  const preflight = click.indexOf('std::wstring preflight', generation);
  const arm = click.indexOf('runtime.armTrustedStart', preflight);
  const dispatch = click.indexOf('DispatchSpotifyDevToolsClick', arm);

  assert.ok(generation >= 0 && preflight > generation && arm > preflight);
  assert.ok(dispatch > arm);
  assert.match(click, /slot\.timedTarget == TimedSpotifyTarget::Music/);
});

test('trusted start is generation scoped, short lived, and cannot override wrong identity', () => {
  assert.match(runtime, /const armTrustedStart = requestedGeneration =>/);
  assert.match(runtime, /requested !== generation\(\)/);
  assert.match(runtime, /state\.trustedStartUntil = Date\.now\(\) \+ 15000/);
  assert.match(runtime, /state\.trustedStartKey !== targetKey\(target\)/);
  assert.match(runtime, /clearTrustedStart\(\);[\s\S]*if \(!state\.startPosted\) return 'unknown'/);
});

test('once trusted media is adopted, missing Spotify metadata cannot drop its completion ownership', () => {
  assert.match(
    runtime,
    /const ownsTrustedMedia = state\.started && state\.targetMedia === media/,
  );
  assert.match(
    runtime,
    /if \(!identity\.path && !identity\.title\) \{[\s\S]*if \(!ownsTrustedMedia\)/,
  );
  assert.match(runtime, /post\('spotify:timed-started'\)/);
});
