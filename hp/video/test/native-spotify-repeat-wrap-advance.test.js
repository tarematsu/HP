import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const guards = readFileSync(
  new URL('../../native/src/spotify_playback_mode_guards.inc', import.meta.url),
  'utf8',
);
const runtime = readFileSync(
  new URL('../../native/src/spotify_media_observer_runtime.inc', import.meta.url),
  'utf8',
);
const events = readFileSync(
  new URL('../../native/src/spotify_media_observer_events.inc', import.meta.url),
  'utf8',
);
const rotation = readFileSync(
  new URL('../../native/src/spotify_timed_end_rotation.inc', import.meta.url),
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

test('repeat wrap is irrelevant after native start deadline is armed', () => {
  assert.match(runtime, /state\.startPosted = true/);
  assert.match(runtime, /postFields\('spotify:timed-started', String\(remainingMs\)\)/);
  assert.doesNotMatch(events, /timeupdate|seeking|seeked|ended|terminalWrap|completionPlan/);
  assert.match(rotation, /one-shot native deadline expires[\s\S]*AdvanceTimedRotationSlot\(slot, now\)/i);
  assert.doesNotMatch(rotation, /spotify:timed-ended|spotify:timed-plan/);
});
