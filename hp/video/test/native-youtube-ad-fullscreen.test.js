import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const recovery = readFileSync(
  new URL('../../native/src/renderer_panels/media_youtube_control_recovery.inc', import.meta.url),
  'utf8',
);
const trusted = readFileSync(
  new URL('../../native/src/renderer_panels/media_youtube_trusted_action.inc', import.meta.url),
  'utf8',
);

test('YouTube ads enter fullscreen before skip or unskippable-ad recovery', () => {
  const adState = recovery.indexOf('const adShowing = trusted.ad()');
  const adFullscreen = recovery.indexOf('if (adShowing && !trusted.fullscreen())');
  const skip = recovery.indexOf("if (adShowing && target) return trusted.arm(target, 'skip-ad', 600)");
  const recoveryOnly = recovery.indexOf("if (adShowing) return 'recovery'");

  assert.ok(adState >= 0);
  assert.ok(adFullscreen > adState);
  assert.ok(skip > adFullscreen);
  assert.ok(recoveryOnly > skip);
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
  assert.match(trusted, /Fullscreen is intentionally valid during ads as well as content/);
});
