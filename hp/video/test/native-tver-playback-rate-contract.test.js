import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const tverStatic = readFileSync(
  new URL('../../native/src/renderer_panels/media_tver_ad_guard.inc', import.meta.url),
  'utf8',
);

test('TVer program playback settings are state-driven', () => {
  assert.match(tverStatic, /const playbackRate = 1\.75/);
  assert.match(tverStatic, /window\.setInterval\(ensure, 4000\)/);
  assert.match(tverStatic, /playbackSettingsApplied/);
  assert.match(tverStatic, /if \(!state\.playbackSettingsApplied\)/);
  assert.match(tverStatic, /state\.playbackSettingsApplied = true/);
  assert.match(tverStatic, /addEventListener\('ratechange'/);
  assert.match(
    tverStatic,
    /activeState\.adActive[\s\S]*window\.__homePanelTverAdActive[\s\S]*return/,
  );
  assert.match(tverStatic, /video\.defaultPlaybackRate = playbackRate/);
  assert.match(tverStatic, /video\.playbackRate = playbackRate/);
});

test('TVer fullscreen recovery is dirty-state driven', () => {
  assert.match(tverStatic, /fullscreenDirty/);
  assert.match(tverStatic, /addEventListener\('fullscreenchange'/);
  assert.match(tverStatic, /activeState\.fullscreenDirty = !fullscreen/);
  assert.match(tverStatic, /state && state\.fullscreenDirty === false/);
  assert.match(tverStatic, /if \(state\) state\.fullscreenDirty = false/);
});

test('TVer ads restore native speed and release HomePanel fullscreen at the boundary', () => {
  assert.match(tverStatic, /const adVideoChanged = state\.adVideo !== video/);
  assert.match(tverStatic, /if \(!state\.adActive \|\| adVideoChanged\)/);
  assert.match(tverStatic, /video\.defaultPlaybackRate = 1\.0/);
  assert.match(tverStatic, /video\.playbackRate = 1\.0/);
  assert.match(tverStatic, /document\.exitFullscreen/);
  assert.match(tverStatic, /state\.playbackSettingsApplied = false/);
  assert.match(tverStatic, /state\.fullscreenDirty = true/);
});

test('TVer static script contains no runtime source rewriting helpers', () => {
  assert.doesNotMatch(tverStatic, /InsertNativeMediaSnippet|ReplaceNativeMediaSnippet/);
  assert.doesNotMatch(tverStatic, /RewriteNativeMediaExecuteScript/);
  assert.doesNotMatch(tverStatic, /std::wstring value/);
});
