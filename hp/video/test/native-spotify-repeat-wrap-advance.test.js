import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const guards = readFileSync(
  new URL('../../native/src/spotify_playback_mode_guards.inc', import.meta.url),
  'utf8',
);
const completion = readFileSync(
  new URL('../../native/src/spotify_media_observer_completion.inc', import.meta.url),
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

test('repeat wrap is fenced by the projected completion deadline', () => {
  assert.match(completion, /const completionPlanDue = \(leadMs = 0\) =>/);
  assert.match(completion, /runtime\.completionPlanDue = completionPlanDue/);
  assert.match(events, /const finishLeadSeconds = 1\.5/);
  assert.match(events, /duration\s*-\s*finishLeadSeconds/);
  assert.match(events, /const finishProjectedWrap = media =>/);
  assert.match(events, /currentTime > 1\.5/);
  assert.match(events, /completionPlanDue\(2000\)/);
  assert.match(events, /document\.addEventListener\('seeking'/);
  assert.match(events, /if \(finishProjectedWrap\(event\.target\)\) return;/);
  assert.match(events, /document\.addEventListener\('pause'/);
});
