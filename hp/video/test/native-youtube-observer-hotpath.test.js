import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const runtime = readFileSync(
  new URL('../../native/src/renderer_panels/media_youtube_control_recovery.inc', import.meta.url),
  'utf8',
);

function section(start, end) {
  const begin = runtime.indexOf(start);
  const finish = runtime.indexOf(end, begin + start.length);
  assert.ok(begin >= 0 && finish > begin, `runtime section missing: ${start}`);
  return runtime.slice(begin, finish);
}

class FakeMutationObserver {
  constructor(callback) { this.callback = callback; }
  observe(target, options) { this.target = target; this.options = options; }
  disconnect() { this.disconnected = true; }
}

test('YouTube player class observer ignores cosmetic changes but detects recovery flags', () => {
  const source = section('    // Ignore cosmetic player class churn;', '    const pageState = () => {');
  const classes = new Set();
  const player = { classList: { contains: name => classes.has(name) } };
  const state = {};
  const wakes = [];
  const observer = vm.runInNewContext(
    `(() => { ${source}\nreturn state.classObserver; })()`,
    {
      state, player, MutationObserver: FakeMutationObserver,
      ad: () => classes.has('ad-showing') || classes.has('ad-interrupting'),
      fullscreen: () => classes.has('ytp-fullscreen'),
      wake: delay => wakes.push(delay),
    },
  );
  assert.equal(observer.target, player);
  assert.deepEqual(Array.from(observer.options.attributeFilter), ['class']);
  observer.callback();
  classes.add('ytp-progress-bar');
  observer.callback();
  assert.deepEqual(wakes, [], 'cosmetic player classes should not wake the native watchdog');

  classes.add('ad-showing');
  observer.callback();
  assert.deepEqual(wakes, [0], 'ad start should still be urgent');
  classes.add('ytp-something-cosmetic');
  observer.callback();
  assert.deepEqual(wakes, [0]);

  classes.delete('ad-showing');
  observer.callback();
  classes.add('ytp-fullscreen');
  observer.callback();
  classes.add('ytp-error');
  observer.callback();
  assert.deepEqual(wakes, [0, 80, 80, 0]);
});

test('YouTube ad observer batches bursts without delaying player-class ad entry', () => {
  const source = section('  const syncAdObserver = active => {', '  if (state.player !== player)');
  const state = {};
  const player = {};
  let now = 1000;
  let dueAt = null;
  let scheduled = 0;
  const wake = delay => {
    const next = now + delay;
    if (dueAt !== null && dueAt <= next) return;
    dueAt = next;
    scheduled++;
  };
  const syncAdObserver = vm.runInNewContext(
    `(() => { ${source}\nreturn syncAdObserver; })()`,
    { state, player, MutationObserver: FakeMutationObserver, wake },
  );
  syncAdObserver(true);
  assert.ok(state.adObserver);
  assert.equal(state.adObserver.target, player); // player-local, not document-wide
  // The runtime only asks for a native wake once per pending 180ms window.
  state.adObserver.callback();
  for (let i = 0; i < 100; i++) state.adObserver.callback();
  assert.equal(scheduled, 1);
  assert.equal(dueAt, 1180);

  now = 1180;
  dueAt = null; // pending timer fires
  state.adObserver.callback();
  assert.equal(scheduled, 2);
  assert.equal(dueAt, 1360);

  const previous = state.adObserver;
  syncAdObserver(false);
  assert.equal(previous.disconnected, true);
  assert.equal(state.adObserver, null);
  assert.match(runtime, /wake\(\(flags & 5\) \? 0 : 80\)/);
});
