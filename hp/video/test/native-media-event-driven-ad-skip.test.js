import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const youtubeClean = readFileSync(
  new URL('../../native/src/renderer_panels/media_youtube_policy.inc', import.meta.url),
  'utf8',
);
const youtubeRuntime = readFileSync(
  new URL(
    '../../native/src/renderer_panels/media_youtube_control_recovery.inc',
    import.meta.url,
  ),
  'utf8',
);
const tver = readFileSync(
  new URL(
    '../../native/src/renderer_panels/media_tver_episode_loop_policy_part2b_observer.inc',
    import.meta.url,
  ),
  'utf8',
);

test('YouTube ad skip readiness has one event-driven runtime owner', () => {
  assert.match(youtubeClean, /ytp-ad-skip-button/);
  assert.doesNotMatch(youtubeClean, /MutationObserver/);
  assert.doesNotMatch(youtubeClean, /homepanel:youtube-wake/);
  assert.doesNotMatch(youtubeClean, /YoutubeSkipObserver|bindSkipObserver|startAdObservers/);

  assert.match(youtubeRuntime, /const skipSelector =/);
  assert.match(youtubeRuntime, /const syncAdObserver = active =>/);
  assert.match(youtubeRuntime, /state\.adObserver = new MutationObserver\(\(\) => wake\(0\)\)/);
  assert.match(
    youtubeRuntime,
    /state\.adObserver\.observe\(player, \{[\s\S]*childList: true,[\s\S]*subtree: true/,
  );
  assert.match(
    youtubeRuntime,
    /attributeFilter: \['disabled', 'aria-disabled', 'aria-hidden', 'class'\]/,
  );
  assert.match(youtubeRuntime, /syncAdObserver\(adActive\)/);
  assert.match(youtubeRuntime, /state\.adObserver\?\.disconnect\(\)/);
  assert.doesNotMatch(youtubeRuntime, /setInterval\s*\(/);
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
