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

test('repeat wrap is fenced by terminal progress evidence with deadline fallback', () => {
  assert.match(completion, /const terminalWitnessWindowSeconds = 2/);
  assert.match(completion, /const terminalWrapSeconds = 1\.5/);
  assert.match(completion, /const observeCompletionProgress = media =>/);
  assert.match(completion, /state\.completionHighWaterTime/);
  assert.match(completion, /state\.completionNearEndArmed = true/);
  assert.match(completion, /const terminalWrapObserved = media =>/);
  assert.match(completion, /currentTime <= terminalWrapSeconds/);
  assert.match(completion, /const completionPlanDue = \(leadMs = 0\) =>/);
  assert.match(completion, /const completionPlanExpired = \(\) => completionPlanDue\(\)/);
  assert.doesNotMatch(events, /finishLeadSeconds|duration\s*-\s*finishLeadSeconds/);
  assert.match(events, /const completionGraceMs = 5000/);
  assert.match(events, /const finishProjectedWrap = media =>/);
  const wrapStart = events.indexOf('const finishProjectedWrap = media =>');
  const wrapEnd = events.indexOf('\n  };', wrapStart);
  assert.ok(wrapStart >= 0 && wrapEnd > wrapStart);
  const wrap = events.slice(wrapStart, wrapEnd + '\n  };'.length);
  assert.match(wrap, /terminalWrapObserved\(media\)/);
  assert.match(wrap, /currentTime <= 1\.5/);
  assert.match(wrap, /completionPlanExpired\(\)/);
  assert.match(wrap, /!witnessedWrap && !deadlineWrap/);
  assert.doesNotMatch(wrap, /completionPlanDue\(completionGraceMs\)/);
  assert.match(events, /const finishPausedAtEnd = media =>/);
  assert.match(events, /document\.addEventListener\('seeking'/);
  assert.match(events, /if \(finishProjectedWrap\(event\.target\)\) return;/);
  assert.match(events, /document\.addEventListener\('pause'/);
});
