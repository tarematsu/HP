import assert from 'node:assert/strict';
import test from 'node:test';
import { readExpandedNativeSource } from './helpers/read-expanded-native-source.js';

const runtime = readExpandedNativeSource(
  '../../native/src/renderer_panels/media_tver_episode_loop_policy.inc', import.meta.url);

test('short TVer media remains an ad even if 1.75x was inherited', () => {
  assert.match(runtime, /shortMedia = length >= 5 && length <= 65/);
  assert.match(runtime, /return explicitAd\(\) \|\| shortMedia/);
  assert.doesNotMatch(runtime, /video\.playbackRate <= 1\.05/);
});

test('an ad ended event cannot arm native episode advancement', () => {
  const ended = runtime.indexOf("event.type === 'ended'");
  const pending = runtime.indexOf('state.programEndPending = true', ended);
  assert.ok(ended >= 0 && pending > ended);
  const branch = runtime.slice(ended, pending + 40);
  assert.match(branch, /key === state\.programKey/);
  assert.match(branch, /!ad\(\) && length > 65/);
  assert.match(branch, /state\.programStartedAt/);
  assert.match(branch, /at >= Math\.max\(3, length - 10\)/);
});
