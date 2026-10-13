import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const native = readFileSync(
  new URL('../../native/src/renderer_panels/media_youtube_control_recovery.inc', import.meta.url),
  'utf8',
);
const runtime = [...native.matchAll(/LR"JS\(([\s\S]*?)\)JS"/g)]
  .map(([, part]) => part).join('');

const start = runtime.indexOf('    function onClick(event) {');
const end = runtime.indexOf('    for (const type of guardedEventTypes)', start);
assert.ok(start >= 0 && end > start, 'trusted click guard must be present');
const code = runtime.slice(start, end);

function verifyAction(action, { advertising = false, paused = true, ended = false } = {}) {
  let videoQueries = 0;
  let prevented = 0;
  let cleanups = 0;
  const player = {
    querySelector(selector) {
      assert.equal(selector, 'video');
      videoQueries++;
      return { paused, ended };
    },
  };
  const onClick = vm.runInNewContext(
    '(() => { ' + code + '\nreturn onClick; })()',
    {
      action, player,
      element: {}, point: { x: 1, y: 1 },
      valid: () => true,
      hitOwnControl: () => true,
      ad: () => advertising,
      fullscreen: () => false,
      setTimeout: callback => { callback(); },
      cleanup: () => { cleanups++; },
    },
  );
  const event = {
    preventDefault() { prevented++; },
    stopImmediatePropagation() {},
  };
  for (let i = 0; i < 100; i++) onClick(event);
  return { videoQueries, prevented, cleanups };
}

test('ad skip, survey, dialog and fullscreen trusted clicks skip video DOM lookups', () => {
  for (const action of ['skip-ad', 'survey-option', 'survey-submit',
    'dialog-continue-watching', 'fullscreen']) {
    const result = verifyAction(action, { advertising: true });
    assert.equal(result.videoQueries, 0, action);
    assert.equal(result.prevented, 0, action);
    assert.equal(result.cleanups, 100, action);
  }
});

test('Play trusted click still rechecks the current video and rejects stale state', () => {
  assert.deepEqual(verifyAction('play', { paused: true }), {
    videoQueries: 100, prevented: 0, cleanups: 100,
  });
  assert.deepEqual(verifyAction('play', { paused: false }), {
    videoQueries: 100, prevented: 100, cleanups: 100,
  });
  assert.deepEqual(verifyAction('play', { paused: true, ended: true }), {
    videoQueries: 100, prevented: 100, cleanups: 100,
  });
  assert.deepEqual(verifyAction('skip-ad', { advertising: false }), {
    videoQueries: 0, prevented: 100, cleanups: 100,
  });
});
