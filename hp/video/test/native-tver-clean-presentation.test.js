import assert from 'node:assert/strict';
import test from 'node:test';
import { readExpandedNativeSource } from './helpers/read-expanded-native-source.js';

const runtime = readExpandedNativeSource(
  '../../native/src/renderer_panels/media_tver_episode_loop_policy.inc', import.meta.url);

test('TVer unified runtime is scoped to episode pages without page-wide presentation mutation', () => {
  assert.match(runtime, /location\.hostname !== 'tver\.jp'/);
  assert.match(runtime, /location\.pathname\.startsWith\('\/episodes\/'\)/);
  assert.doesNotMatch(runtime, /installCleanPresentation|strengthenCleanPresentation/);
  assert.doesNotMatch(runtime, /homepanel-tver-clean-player/);
  assert.doesNotMatch(runtime, /body:has\(video\)|main:has\(video\)/);
});

test('TVer controls stay player-local while dialogs remain independently actionable', () => {
  assert.match(runtime, /const player = video\.closest/);
  assert.match(runtime, /const controls = \(\) => Array\.from\(player\.querySelectorAll/);
  assert.match(runtime, /\[role="dialog"\],\[aria-modal="true"\]/);
  assert.match(runtime, /arm\(close, 'dialog-close', 500\)/);
  assert.doesNotMatch(runtime, /display:none !important|overflow:hidden !important/);
});
