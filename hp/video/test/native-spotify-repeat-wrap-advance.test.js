import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const guards = readFileSync(
  new URL('../../native/src/spotify_playback_mode_guards.inc', import.meta.url),
  'utf8',
);
const events = readFileSync(
  new URL('../../native/src/spotify_media_observer_events.inc', import.meta.url),
  'utf8',
);

test('repeat guard survives Spotify builds that omit aria-checked', () => {
  assert.match(guards, /const label = normalize\(/);
  assert.match(guards, /label\.includes\('repeat one'\)/);
  assert.match(guards, /label\.includes\('disable repeat'\)/);
  assert.match(guards, /label\.includes\('enable repeat'\)/);
  assert.match(guards, /checked === null && labelActive/);
  assert.match(guards, /checked === null && labelOff/);
  assert.ok(
    guards.indexOf("label.includes('repeat one')") <
      guards.indexOf("label.includes('enable repeat')"),
    'Enable repeat one must be treated as active repeat, not repeat-off',
  );
});

test('same-media repeat wrap advances only after the physical track end', () => {
  assert.match(events, /const detectRepeatWrap = media =>/);
  assert.match(events, /marker\.key !== state\.key/);
  assert.match(events, /previousTime >= Math\.max\(0, duration - 3\)/);
  assert.match(events, /currentTime <= 1\.5/);
  assert.match(events, /previousTime - currentTime >= 2/);
  assert.match(events, /if \(!wrapped \|\| !finishTarget\(media\)\) return false;/);
  assert.match(events, /quarantineMedia\(media\);[\s\S]*return true;/);
  assert.match(events, /document\.addEventListener\('seeking'/);
  assert.match(events, /if \(detectRepeatWrap\(media\)\) return;/);
  assert.doesNotMatch(events, /duration\s*-\s*finishLeadSeconds/);
});
