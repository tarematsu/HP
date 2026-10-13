import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const native = readFileSync(
  new URL('../../native/src/renderer_panels/media_youtube_control_recovery.inc', import.meta.url),
  'utf8',
);
const runtime = [...native.matchAll(/LR"JS\(([\s\S]*?)\)JS"/g)]
  .map(([, part]) => part).join('');
const section = (begin, end) => {
  const i = runtime.indexOf(begin);
  const j = runtime.indexOf(end, i + begin.length);
  assert.ok(i >= 0 && j > i, 'missing YouTube runtime section: ' + begin);
  return runtime.slice(i, j);
};

function dialogScenario({ label = 'Still watching?', controls = [] } = {}) {
  const inspected = [];
  const actions = [];
  const root = {
    getClientRects: () => [1],
    matches: () => false,
    querySelector: () => null,
    querySelectorAll: () => controls,
    label,
  };
  const popup = { querySelectorAll: () => [root] };
  const document = { querySelector: () => popup };
  const code = section(
    '  const dismissMessageDialog = () => {',
    '  const bindVideo = (refresh = false) => {',
  );
  const action = runInNewContext(
    '(() => { ' + code + '\nreturn dismissMessageDialog(); })()',
    {
      document,
      surveySelector: '.survey',
      valid: element => element.connected !== false,
      text: element => element.label,
      arm: (element, name) => {
        actions.push(name);
        return { id: element.id, action: name };
      },
    },
  );
  return { action, actions, inspected };
}

function control(id, label, { visible = true, connected = true } = {}) {
  const element = {
    id, label, connected, rectReads: 0,
    getClientRects: () => {
      element.rectReads++;
      return visible ? [1] : [];
    },
  };
  return element;
}

test('YouTube Keep Watching wins over an earlier Close without layout for unrelated controls', () => {
  const unrelated = Array.from({ length: 60 }, (_, i) => control(i, 'menu ' + i));
  const close = control(61, '閉じる');
  const keep = control(62, '続ける');
  const result = dialogScenario({
    label: '動画がまもなく一時停止されます',
    controls: [...unrelated, close, keep],
  });
  assert.deepEqual({ ...result.action }, {
    id: 62, action: 'dialog-continue-watching',
  });
  assert.equal(unrelated.reduce((sum, el) => sum + el.rectReads, 0), 0);
  assert.equal(close.rectReads, 1);
  assert.equal(keep.rectReads, 1);
  assert.deepEqual(result.actions, ['dialog-continue-watching']);
});

test('non-continuation dialog closes without examining unrelated button geometry', () => {
  const unrelated = control(1, 'play');
  const yes = control(2, 'Yes');
  const close = control(3, 'Close');
  const result = dialogScenario({
    label: 'A regular information dialog',
    controls: [unrelated, yes, close],
  });
  assert.equal(result.action.id, 3);
  assert.equal(result.action.action, 'dialog-close');
  assert.equal(unrelated.rectReads + yes.rectReads, 0);
  assert.equal(close.rectReads, 1);
});

test('hidden Keep Watching does not displace visible Close', () => {
  const hidden = control(1, 'Continue', { visible: false });
  const close = control(2, 'Close');
  const result = dialogScenario({
    label: 'Continue watching',
    controls: [hidden, close],
  });
  assert.equal(result.action.id, 2);
  assert.deepEqual(result.actions, ['dialog-close']);
});

function adScenario({ controls = [], skipButtons = [], selected = false } = {}) {
  const calls = [];
  const state = { surveySelected: selected };
  const survey = {
    querySelectorAll: () => controls,
  };
  const player = {
    querySelectorAll: selector => selector.includes('[role="dialog"]') ?
      [survey] : skipButtons,
  };
  const code = section('  if (adActive) {', '  state.adActive = false;');
  const outcome = runInNewContext(
    '(() => { ' + code + "\nreturn 'normal'; })()",
    {
      adActive: true, state, player,
      surveySelector: '.survey', skipSelector: '.skip',
      valid: element => element.connected !== false,
      text: element => {
        element.labelReads = (element.labelReads || 0) + 1;
        return element.label;
      },
      arm: (element, action) => { calls.push(action); return { id: element.id, action }; },
      requestFullscreen: () => 'fullscreen',
      fullscreen: () => true,
      recheck: () => {},
    },
  );
  return { calls, outcome, state };
}

test('YouTube ad survey retains option-first, then submit, with one label read per control', () => {
  const option = { id: 2, label: '回答1' };
  const submit = { id: 1, label: '送信' };
  const unrelated = { id: 0, label: 'キャンセル' };
  const inputs = [unrelated, submit, option];
  const first = adScenario({ controls: inputs });
  assert.equal(first.outcome.action, 'survey-option');
  assert.equal(first.outcome.id, 2);
  assert.equal(option.labelReads, 1);
  assert.equal(submit.labelReads, 1);
  // Re-run with a fresh DOM label count; state.surveySelected is passed in.
  const second = adScenario({ controls: inputs, selected: true });
  assert.equal(second.outcome.action, 'survey-submit');
  assert.equal(second.outcome.id, 1);
  assert.equal(option.labelReads, 2);
  assert.equal(submit.labelReads, 2);
});

test('skip-ad first-valid candidate and ad fallback remain intact without an array copy', () => {
  const skip = adScenario({
    skipButtons: [{ id: 1, label: 'skip', connected: false }, { id: 2, label: 'skip' }],
  });
  assert.equal(skip.outcome.id, 2);
  assert.equal(skip.outcome.action, 'skip-ad');
  assert.deepEqual(skip.calls, ['skip-ad']);

  const missing = adScenario();
  assert.equal(missing.outcome, 'recovery');
});

test('YouTube hot paths avoid Array.from and preserve exact trusted action names', () => {
  assert.doesNotMatch(runtime, /Array\.from\(/);
  assert.match(runtime, /return arm\(keepWatching, 'dialog-continue-watching', 1000\)/);
  assert.match(runtime, /return arm\(close, 'dialog-close', 500\)/);
  assert.match(runtime, /return arm\(fallback, 'fullscreen', 1200\)/);
  assert.match(runtime, /return arm\(target, 'skip-ad', 600\)/);
});
