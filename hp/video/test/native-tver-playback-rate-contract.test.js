import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const composition = readFileSync(
  new URL('../../native/src/renderer_panels.cpp', import.meta.url),
  'utf8',
);
const tverAdGuard = readFileSync(
  new URL('../../native/src/renderer_panels/media_tver_ad_guard.inc', import.meta.url),
  'utf8',
);

test('TVer playback settings are state-driven instead of rewritten every watchdog cycle', () => {
  assert.match(composition, /const playbackRate = 1\.75/);
  assert.match(composition, /window\.setInterval\(ensure, 4000\)/);
  assert.match(tverAdGuard, /playbackSettingsApplied/);
  assert.match(tverAdGuard, /if \(!state\.playbackSettingsApplied\)/);
  assert.match(tverAdGuard, /state\.playbackSettingsApplied = true/);
  assert.match(tverAdGuard, /addEventListener\('ratechange'/);
  assert.match(
    tverAdGuard,
    /activeState\.adActive[\s\S]*window\.__homePanelTverAdActive[\s\S]*return/,
  );
  assert.match(tverAdGuard, /video\.defaultPlaybackRate = playbackRate/);
  assert.match(tverAdGuard, /video\.playbackRate = playbackRate/);
});

test('TVer fullscreen recovery is dirty-state driven', () => {
  assert.match(tverAdGuard, /fullscreenDirty/);
  assert.match(tverAdGuard, /addEventListener\('fullscreenchange'/);
  assert.match(tverAdGuard, /activeState\.fullscreenDirty = !fullscreen/);
  assert.match(tverAdGuard, /state && state\.fullscreenDirty === false/);
  assert.match(tverAdGuard, /if \(state\) state\.fullscreenDirty = false/);
});

test('TVer ads restore native speed once without forcing fullscreen exit', () => {
  assert.match(tverAdGuard, /const adVideoChanged = state\.adVideo !== video/);
  assert.match(tverAdGuard, /if \(!state\.adActive \|\| adVideoChanged\)/);
  assert.match(tverAdGuard, /video\.defaultPlaybackRate = 1\.0/);
  assert.match(tverAdGuard, /video\.playbackRate = 1\.0/);
  assert.doesNotMatch(tverAdGuard, /document\.exitFullscreen/);
  assert.match(tverAdGuard, /state\.playbackSettingsApplied = false/);
  assert.match(tverAdGuard, /state\.fullscreenDirty = true/);
});
