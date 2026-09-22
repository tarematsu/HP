import assert from 'node:assert/strict';
import test from 'node:test';
import { readExpandedNativeSource } from './helpers/read-expanded-native-source.js';

const runtime = readExpandedNativeSource(
  '../../native/src/renderer_panels/media_tver_episode_loop_policy.inc', import.meta.url);

test('short TVer media is classified as ad until it is the confirmed program key', () => {
  assert.match(runtime, /shortMedia = length >= 5 && length <= 65/);
  assert.match(runtime, /key !== state\.programKey/);
  assert.match(runtime, /video\.playbackRate <= 1\.05/);
});

test('an ad ended event cannot arm native episode advancement', () => {
  const ended = runtime.indexOf("event.type === 'ended'");
  const pending = runtime.indexOf('state.programEndPending = true', ended);
  assert.ok(ended >= 0 && pending > ended);
  const branch = runtime.slice(ended, pending + 40);
  assert.match(branch, /key === state\.programKey/);
  assert.match(branch, /length >= 5/);
  assert.match(branch, /at >= Math\.max\(3, length - 10\)/);
});
