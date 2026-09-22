import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { readExpandedNativeSource } from './helpers/read-expanded-native-source.js';

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
const tver = readExpandedNativeSource(
  '../../native/src/renderer_panels/media_tver_episode_loop_policy.inc', import.meta.url);

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

test('TVer skip controls use the same event-wake plus trusted-target model', () => {
  assert.match(tver, /state\.playerObserver = new MutationObserver\(\(\) => wake\(0\)\)/);
  assert.match(
    tver,
    /attributeFilter: \['class','disabled','aria-disabled','aria-hidden'\]/,
  );
  assert.match(tver, /const skipPattern =/);
  assert.match(tver, /arm\(skip, 'skip-ad', 600\)/);
  assert.match(tver, /document\.elementFromPoint/);
  assert.match(tver, /post\('homepanel:tver-wake'\)/);
  assert.doesNotMatch(tver, /setInterval\s*\(/);
});
