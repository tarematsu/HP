import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const source = readFileSync(
  new URL('../../native/src/renderer_panels/media_tver_control_recovery.inc', import.meta.url),
  'utf8',
);
const script = [...source.matchAll(/LR"JS\(([\s\S]*?)\)JS"/g)]
  .map(([, chunk]) => chunk).join('');
const begin = script.indexOf('  const wake = (delay = 80) => {');
const end = script.indexOf('  const recheck =', begin);
assert.ok(begin >= 0 && end > begin, 'TVer wake controller missing');
const wakeSource = script.slice(begin, end);

test('TVer mutation bursts keep one earliest scheduled native wake', () => {
  let now = 1000;
  let nextId = 0;
  let installs = 0;
  const pending = new Map();
  class Clock extends Date { static now() { return now; } }
  const runtime = runInNewContext(
    '(() => { const state = {}; const messages = []; ' +
      'const post = message => messages.push(message);\n' +
      wakeSource + '\nreturn { state, messages, wake }; })()',
    {
      Date: Clock,
      setTimeout(callback, delay) {
        const id = ++nextId;
        installs++;
        pending.set(id, { callback, delay });
        return id;
      },
      clearTimeout: id => pending.delete(id),
    },
  );

  runtime.wake(2000);
  runtime.wake(2000);
  assert.equal(installs, 1, 'duplicate late wakes must not reset a pending timer');
  runtime.wake(80);
  assert.equal(installs, 2, 'urgent recovery should replace a later wake');
  assert.equal(pending.size, 1);
  for (let i = 0; i < 100; i++) runtime.wake(80);
  assert.equal(installs, 2, 'a mutation burst must not allocate more timers');
  assert.equal(pending.size, 1);
  const timer = [...pending.values()][0];
  pending.clear();
  timer.callback();
  assert.deepEqual(Array.from(runtime.messages), ['homepanel:tver-wake']);
  assert.equal(runtime.state.wakeTimer, null);
  now += 100;
  runtime.wake(80);
  assert.equal(installs, 3, 'a delivered wake must allow future notifications');
});
