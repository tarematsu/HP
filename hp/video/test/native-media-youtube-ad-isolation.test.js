import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const recovery = readFileSync(
  new URL('../../native/src/renderer_panels/media_youtube_control_recovery.inc', import.meta.url), 'utf8');

test('YouTube ad branch is isolated from content mutation', () => {
  const adStart = recovery.indexOf('if (adShowing) {');
  const contentState = recovery.indexOf('const recoveryState =');
  assert.ok(adStart >= 0 && contentState > adStart);
  const adBranch = recovery.slice(adStart, contentState);
  assert.match(adBranch, /surveyRoots/);
  assert.match(adBranch, /skipSelectors/);
  assert.match(adBranch, /trusted\.arm\(target, 'skip-ad', 600\)/);
  assert.match(adBranch, /trusted\.arm\(target, 'fullscreen', 1200\)/);
  assert.doesNotMatch(adBranch, /setPlaybackQuality/);
  assert.doesNotMatch(adBranch, /video\.play\(/);
  assert.doesNotMatch(adBranch, /setOption\('captions'/);
});

test('YouTube content quality is state-driven and never touched during ads', () => {
  const contentState = recovery.indexOf('const recoveryState =');
  const preferred = recovery.indexOf("const preferredQuality = 'large'", contentState);
  assert.ok(contentState >= 0 && preferred > contentState);
  assert.match(recovery, /qualityApplied: false/);
  assert.match(recovery, /if \(!recoveryState\.qualityApplied\)/);
  assert.match(recovery, /player\.getPlaybackQuality\(\) !== preferredQuality/);
});

test('YouTube error discovery is player-local', () => {
  assert.match(recovery, /player\.querySelectorAll\(/);
  assert.doesNotMatch(
    recovery,
    /document\.querySelectorAll\(\s*'\.ytp-error/,
  );
});
