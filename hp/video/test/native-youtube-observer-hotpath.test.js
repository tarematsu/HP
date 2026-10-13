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
  // Adjacent C++ raw-string chunks are one JS program at runtime.
  return runtime.slice(begin, finish).replace(/\)JS" LR"JS\(/g, '');
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

test('YouTube ad observer ignores unrelated mutations and batches actionable changes', () => {
  const source = section('  const syncAdObserver = active => {', '  if (state.player !== player)');
  const player = { nodeType: 1 };
  const state = {};
  let now = 1000;
  let dueAt = null;
  let scheduled = 0;
  const wake = delay => {
    const next = now + delay;
    if (dueAt !== null && dueAt <= next) return;
    dueAt = next;
    scheduled++;
  };
  const makeNode = (kind, children = [], parent = null) => {
    const node = { nodeType: 1, kind, children, parentElement: parent };
    node.matches = selector =>
      (kind === 'skip' && selector.includes('.ytp-ad-skip-button')) ||
      (kind === 'survey' && selector.includes('.ytp-ad-survey')) ||
      (kind === 'dialog' && selector.includes('[role="dialog"]'));
    node.closest = selector => {
      for (let p = node; p; p = p.parentElement) {
        if (p.matches?.(selector)) return p;
      }
      return null;
    };
    node.querySelector = selector =>
      children.find(child => child.matches(selector) || child.querySelector(selector)) || null;
    for (const child of children) child.parentElement = node;
    return node;
  };
  const irrelevant = makeNode('chrome');
  const skip = makeNode('skip');
  const survey = makeNode('survey');
  const genericWrapper = makeNode('wrapper', [skip]);
  const event = (target, addedNodes = [], removedNodes = []) =>
    ({ type: 'childList', target, addedNodes, removedNodes });
  const attr = (target, attributeName) => ({ type: 'attributes', target, attributeName });
  const syncAdObserver = vm.runInNewContext(
    `(() => { ${source}\nreturn syncAdObserver; })()`,
    {
      state, player, MutationObserver: FakeMutationObserver, wake,
      skipSelector: '.ytp-ad-skip-button', surveySelector: '.ytp-ad-survey',
    },
  );
  syncAdObserver(true);
  const observer = state.adObserver;
  assert.equal(observer.target, player);
  assert.equal(observer.options.subtree, true);
  for (let i = 0; i < 100; i++) {
    observer.callback([event(irrelevant, [makeNode('chrome')])]);
    observer.callback([attr(irrelevant, 'class')]);
    observer.callback([attr(player, 'class')]);
  }
  assert.equal(scheduled, 0, 'unrelated DOM churn must not wake WebView2');
  // Detect a control nested inside a newly mounted advertising wrapper.
  observer.callback([event(player, [genericWrapper])]);
  assert.equal(scheduled, 1);
  assert.equal(dueAt, 1180);
  for (let i = 0; i < 100; i++) {
    observer.callback([attr(skip, 'disabled')]);
  }
  assert.equal(scheduled, 1, 'actionable bursts must share one pending timer');

  now = 1180;
  dueAt = null;
  observer.callback([attr(survey, 'aria-disabled')]);
  assert.equal(scheduled, 2);
  assert.equal(dueAt, 1360);

  now = 1360;
  dueAt = null;
  observer.callback([attr(genericWrapper, 'aria-hidden')]);
  assert.equal(scheduled, 3, 'hidden parent of a skip button still triggers readiness');
  now = 1540;
  dueAt = null;
  observer.callback([event(player, [], [genericWrapper])]);
  assert.equal(scheduled, 4, 'removed controls are actionable');
  now = 1720;
  dueAt = null;
  observer.callback([event(player, [makeNode('dialog')])]);
  assert.equal(scheduled, 5, 'survey/dialog overlays remain actionable');

  syncAdObserver(false);
  assert.equal(observer.disconnected, true);
  assert.equal(state.adObserver, null);
  assert.match(runtime, /wake\(\(flags & 5\) \? 0 : 80\)/);
});
