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
      state: {},
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

function adScenario({
  controls = [], skipButtons = [], state = {}, now = 1000,
  skipArmUnavailable = false,
} = {}) {
  const calls = [];
  const survey = {
    querySelectorAll: () => controls,
    connected: true,
  };
  let surveyQueries = 0;
  let skipQueries = 0;
  let skipIterations = 0;
  const player = {
    querySelectorAll(selector) {
      if (selector === '.survey,[role="dialog"]') {
        surveyQueries++;
        return [survey];
      }
      assert.equal(selector, '.skip');
      skipQueries++;
      return {
        *[Symbol.iterator]() {
          for (const element of skipButtons) {
            skipIterations++;
            yield element;
          }
        },
      };
    },
  };
  const code = section('  if (adActive) {', '  state.adActive = false;');
  const outcome = runInNewContext(
    '(() => { ' + code + "\nreturn 'normal'; })()",
    {
      adActive: true, state, player, now,
      surveyDialogSelector: '.survey,[role="dialog"]',
      skipSelector: '.skip',
      scanAdCandidates: () => player.querySelectorAll('.skip'),
      valid: element => element.connected !== false,
      text: element => {
        element.labelReads = (element.labelReads || 0) + 1;
        return element.label;
      },
      arm: (element, action) => {
        calls.push(action);
        return skipArmUnavailable && action === 'skip-ad'
          ? null : { id: element.id, action };
      },
      requestFullscreen: () => 'fullscreen',
      fullscreen: () => true,
      wake: delay => calls.push('wake:' + delay),
    },
  );
  return { calls, outcome, state, surveyQueries, skipQueries, skipIterations };
}

test('YouTube ad survey preserves option then submit within a bounded followup', () => {
  const option = { id: 2, label: '回答1' };
  const submit = { id: 1, label: '送信' };
  const unrelated = { id: 0, label: 'キャンセル' };
  const controls = [unrelated, submit, option];
  const state = {};
  const first = adScenario({ controls, state, now: 1000 });
  assert.equal(first.outcome.action, 'survey-option');
  assert.equal(first.outcome.id, 2);
  assert.equal(first.surveyQueries, 1);
  assert.equal(first.skipQueries, 0);
  assert.equal(option.labelReads, 1);
  assert.equal(submit.labelReads, 1);
  assert.equal(state.surveySelected, true);
  assert.equal(state.surveyFollowupUntil, 16000);
  const second = adScenario({ controls, state, now: 3000 });
  assert.equal(second.outcome.action, 'survey-submit');
  assert.equal(second.outcome.id, 1);
  assert.equal(second.surveyQueries, 1);
  assert.equal(second.skipQueries, 0);
  assert.equal(state.surveySelected, false);
  assert.equal(option.labelReads, 2);
  assert.equal(submit.labelReads, 2);
});

test('Skip Ad remains immediate even while survey checks are throttled', () => {
  const skipButtons = [
    { id: 1, label: 'skip', connected: false },
    { id: 2, label: 'skip' },
  ];
  const state = { surveyCheckedAt: 1000, surveySelected: false };
  const skip = adScenario({ skipButtons, state, now: 2000 });
  assert.equal(skip.outcome.id, 2);
  assert.equal(skip.outcome.action, 'skip-ad');
  assert.deepEqual(skip.calls, ['skip-ad']);
  assert.equal(skip.surveyQueries, 0);
  assert.equal(skip.skipQueries, 1);
  assert.equal(skip.skipIterations, 2);

  const cooldown = adScenario({
    skipButtons: [{ id: 3, connected: true }],
    state, now: 2500, skipArmUnavailable: true,
  });
  assert.equal(cooldown.outcome, 'recovery');
  assert.deepEqual(cooldown.calls, ['skip-ad', 'wake:1000'],
    'a found-but-unarmable Skip Ad control must get a fast retry');
  assert.equal(cooldown.surveyQueries, 0,
    'the retry does not override five-minute survey rate limits');

  const missing = adScenario({ state, now: 3000 });
  assert.equal(missing.outcome, 'recovery');
  assert.deepEqual(missing.calls, ['wake:5000']);
  assert.equal(missing.surveyQueries, 0);
  assert.doesNotMatch(runtime.slice(runtime.indexOf('if (adActive) {'),
    runtime.indexOf('  state.adActive = false;')), /recheck\(\)/);
});

test('YouTube surveys run once per 5 minutes across ad wake bursts', () => {
  const state = {};
  const first = adScenario({ state, now: 1000 });
  assert.equal(first.surveyQueries, 1);
  for (let i = 0; i < 200; i++) {
    const result = adScenario({ state, now: 1001 + i * 1000 });
    assert.equal(result.surveyQueries, 0);
    assert.equal(result.skipQueries, 1);
  }
  assert.equal(adScenario({ state, now: 300999 }).surveyQueries, 0);
  assert.equal(adScenario({ state, now: 301000 }).surveyQueries, 1);
  assert.equal(adScenario({ state, now: 302000 }).surveyQueries, 0);
});

test('an active survey takes priority over Skip Ad only on scheduled checks', () => {
  const controls = [{ id: 11, label: '送信' }, { id: 12, label: '回答1' }];
  const skipButtons = [{ id: 1, label: 'skip' }];
  const state = {};
  const first = adScenario({ controls, skipButtons, state, now: 1000 });
  assert.equal(first.outcome.action, 'survey-option');
  assert.equal(first.outcome.id, 12);
  assert.equal(first.skipQueries, 0);
  const second = adScenario({ controls, skipButtons, state, now: 3000 });
  assert.equal(second.outcome.action, 'survey-submit');
  assert.equal(second.skipQueries, 0);
  const third = adScenario({ controls, skipButtons, state, now: 4000 });
  assert.equal(third.outcome.action, 'skip-ad');
  assert.equal(third.surveyQueries, 0);
  assert.equal(third.skipQueries, 1);
});

test('unfinished survey followup expires rather than polling forever', () => {
  const state = {
    surveyCheckedAt: 1000, surveySelected: true, surveyFollowupUntil: 16000,
  };
  const first = adScenario({ state, now: 15000 });
  assert.equal(first.surveyQueries, 1, 'active followup may briefly query survey');
  const second = adScenario({ state, now: 16000 });
  assert.equal(second.surveyQueries, 0);
  assert.equal(state.surveySelected, false);
  assert.equal(adScenario({ state, now: 314999 }).surveyQueries, 0);
  assert.equal(adScenario({ state, now: 315000 }).surveyQueries, 1,
    'the five-minute interval begins with the last followup check');
});

test('YouTube hot paths avoid Array.from and preserve exact trusted action names', () => {
  assert.doesNotMatch(runtime, /Array\.from\(/);
  assert.match(runtime, /return arm\(keepWatching, 'dialog-continue-watching', 1000\)/);
  assert.match(runtime, /return arm\(close, 'dialog-close', 500\)/);
  assert.match(runtime, /return arm\(fallback, 'fullscreen', 1200\)/);
  assert.match(runtime, /const action = arm\(target, 'skip-ad', 600\)/);
});
