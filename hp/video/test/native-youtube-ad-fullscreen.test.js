import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const recovery = readFileSync(
  new URL('../../native/src/renderer_panels/media_youtube_control_recovery.inc', import.meta.url), 'utf8');
const trusted = readFileSync(
  new URL('../../native/src/renderer_panels/media_youtube_trusted_action.inc', import.meta.url), 'utf8');

test('YouTube ads restore fullscreen before skip lookup', () => {
  const adState = recovery.indexOf('const adShowing = trusted.ad()');
  const adBranch = recovery.indexOf('if (adShowing) {');
  const fullscreen = recovery.indexOf('if (!trusted.fullscreen())', adBranch);
  const skip = recovery.indexOf('const skipSelectors = [', adBranch);
  const guard = recovery.indexOf("return 'recovery';", adBranch);
  assert.ok(adState >= 0);
  assert.ok(adBranch > adState);
  assert.ok(fullscreen > adBranch);
  assert.ok(skip > fullscreen);
  assert.ok(guard > skip);
  assert.match(
    recovery,
    /const fullscreenAction = trusted\.arm\(target, 'fullscreen', 1200\)[\s\S]*if \(fullscreenAction\) return fullscreenAction/,
  );
});

test('trusted fullscreen click remains valid while an ad is active', () => {
  assert.match(
    trusted,
    /if \(action === 'fullscreen' && \(fullscreen\(\) \|\| !player\(\)\)\)/,
  );
  assert.doesNotMatch(
    trusted,
    /action === 'fullscreen' && \(ad\(\) \|\| fullscreen\(\)/,
  );
});
