import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const youtube = readFileSync(
  new URL('../../native/src/renderer_panels/media_youtube_policy.inc', import.meta.url),
  'utf8',
);
const tver = readFileSync(
  new URL(
    '../../native/src/renderer_panels/media_tver_episode_loop_policy_part2b_observer.inc',
    import.meta.url,
  ),
  'utf8',
);

test('YouTube ad skip readiness is event-driven and active only during ads', () => {
  assert.match(youtube, /const skipSelector = \[/);
  assert.match(youtube, /const adActive = player => Boolean/);
  assert.match(youtube, /homepanel:youtube-wake/);
  assert.match(youtube, /const startAdObservers = \(\) =>/);
  assert.match(youtube, /const stopAdObservers = \(\) =>/);
  assert.match(youtube, /rootObserver\.observe\(player, \{ childList: true, subtree: true \}\)/);
  assert.match(youtube, /rootObserver\.disconnect\(\)/);
  assert.match(youtube, /classObserver\.observe\(player/);
  assert.match(
    youtube,
    /attributeFilter: \['disabled', 'aria-disabled', 'aria-hidden', 'class', 'style'\]/,
  );
  assert.match(youtube, /if \(adActive\(player\)\) startAdObservers\(\)/);
  assert.match(youtube, /< 80/);
  assert.doesNotMatch(youtube, /setInterval\s*\(/);
});

test('TVer skip controls wake recovery on actionable attribute changes', () => {
  assert.match(tver, /const skipControlSelector = \[/);
  assert.match(tver, /const skipControlObservers = new Map\(\)/);
  assert.match(tver, /wakeNative\('skip-ready:' \+ playerUiRevision\)/);
  assert.match(tver, /scheduleEnsure\(0\)/);
  assert.match(
    tver,
    /attributeFilter: \['disabled', 'aria-disabled', 'aria-hidden', 'class', 'style'\]/,
  );
  assert.match(tver, /playerObserver\.observe\(root, \{ childList: true, subtree: true \}\)/);
  assert.match(tver, /disconnectSkipControlObservers\(\)/);
  assert.match(tver, /wakeNative\('ui:' \+ playerUiRevision\)/);
  assert.doesNotMatch(tver, /setInterval\s*\(/);
});
