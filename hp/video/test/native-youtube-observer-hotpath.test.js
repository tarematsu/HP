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
  observe(target, options) {
    this.target = target;
    this.options = options;
    (this.observations ||= []).push({ target, options });
  }
  disconnect() { this.disconnected = true; this.observations = []; }
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

test('YouTube ad observers avoid page-wide attribute monitoring', () => {
  const source = section('  const syncAdObserver = active => {', '  if (state.player !== player)');
  let controls = [];
  const player = { nodeType: 1, querySelectorAll: () => controls };
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
  const node = (kind, children = [], parent = null) => {
    const n = { nodeType: 1, kind, children, parentElement: parent, firstElementChild: children[0] || null };
    n.matches = selector =>
      (kind === 'skip' && selector.includes('.ytp-ad-skip-button')) ||
      (kind === 'survey' && selector.includes('.ytp-ad-survey')) ||
      (kind === 'dialog' && selector.includes('[role="dialog"]'));
    n.closest = selector => {
      for (let p = n; p; p = p.parentElement) {
        if (p.matches?.(selector)) return p;
      }
      return null;
    };
    n.querySelector = selector =>
      children.find(child => child.matches(selector) || child.querySelector(selector)) || null;
    for (const child of children) child.parentElement = n;
    return n;
  };
  const unrelated = node('progress');
  const skip = node('skip');
  const survey = node('survey');
  const dialog = node('dialog');
  const wrapper = node('wrapper', [skip]);
  wrapper.parentElement = player;
  const event = (target, addedNodes = [], removedNodes = []) =>
    ({ type: 'childList', target, addedNodes, removedNodes });
  const attr = target => ({ type: 'attributes', target, attributeName: 'class' });
  const syncAdObserver = vm.runInNewContext(
    '(() => { ' + source + '\nreturn syncAdObserver; })()',
    {
      state, player, MutationObserver: FakeMutationObserver, wake,
      skipSelector: '.ytp-ad-skip-button', surveySelector: '.ytp-ad-survey',
      adControlSelector: '.ytp-ad-survey,[role="dialog"],.ytp-ad-skip-button',
    },
  );
  syncAdObserver(true);
  const observer = state.adObserver;
  const attrObserver = state.adControlObserver;
  assert.equal(observer.target, player);
  assert.equal(observer.options.subtree, true);
  assert.equal(observer.options.childList, true);
  assert.equal(observer.options.attributes, undefined,
    'whole player subtree must NOT observe class or ARIA changes');
  assert.equal(attrObserver.observations?.length || 0, 0);
  for (let i = 0; i < 100; i++) {
    observer.callback([event(player, [node('progress')])]);
    observer.callback([attr(unrelated)]);
    observer.callback([attr(player)]);
  }
  assert.equal(scheduled, 0, 'unrelated DOM churn must not wake WebView2');

  controls = [skip];
  observer.callback([event(player, [wrapper])]);
  assert.equal(scheduled, 1);
  assert.equal(dueAt, 1180);
  assert.deepEqual(attrObserver.observations.map(x => x.target), [skip, wrapper]);
  assert.deepEqual(Array.from(attrObserver.observations[0].options.attributeFilter),
    ['disabled', 'aria-disabled', 'aria-hidden', 'class']);
  assert.ok(!attrObserver.observations.some(x => x.target === player || x.target === unrelated));
  for (let i = 0; i < 100; i++) attrObserver.callback([attr(skip)]);
  assert.equal(scheduled, 1, 'control class/ARIA bursts must share one pending wake');

  now = 1180;
  dueAt = null;
  attrObserver.callback([attr(wrapper)]);
  assert.equal(scheduled, 2, 'ancestor class changes still trigger detection');
  assert.equal(dueAt, 1360);

  now = 1360;
  dueAt = null;
  controls = [skip, survey];
  survey.parentElement = player;
  observer.callback([event(player, [survey])]);
  assert.equal(scheduled, 3);
  assert.ok(attrObserver.observations.some(x => x.target === survey));
  now = 1540;
  dueAt = null;
  controls = [survey];
  observer.callback([event(player, [], [wrapper])]);
  assert.equal(scheduled, 4, 'removed controls remain actionable');
  assert.ok(!attrObserver.observations.some(x => x.target === skip));

  now = 1720;
  dueAt = null;
  controls = [survey, dialog];
  dialog.parentElement = player;
  observer.callback([event(player, [dialog])]);
  assert.equal(scheduled, 5, 'survey/dialog overlays remain actionable');

  syncAdObserver(false);
  assert.equal(observer.disconnected, true);
  assert.equal(attrObserver.disconnected, true);
  assert.equal(state.adObserver, null);
  assert.equal(state.adControlObserver, null);
  assert.equal(state.adObservedNodes, null);
  assert.match(runtime, /wake\(\(flags & 5\) \? 0 : 80\)/);
});
