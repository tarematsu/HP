import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const nativeSource = readFileSync(
  new URL('../../native/src/renderer_panels/media_tver_control_recovery.inc', import.meta.url),
  'utf8',
);
const expanded = [...nativeSource.matchAll(/LR"JS\(([\s\S]*?)\)JS"/g)]
  .map(([, chunk]) => chunk).join('');
const begin = expanded.indexOf('  const controlSelector =');
const end = expanded.indexOf('  const actionLane =', begin);
assert.ok(begin >= 0 && end > begin, 'TVer ad classifier must exist');
const snippet = expanded.slice(begin, end);

function scenario({ length = 1800, controls = [], markers = [] } = {}) {
  const counts = { controls: 0, markers: 0, visibility: 0 };
  const player = {
    querySelectorAll: selector => {
      if (selector.includes('[role="menuitem"]')) {
        counts.controls++;
        return controls;
      }
      counts.markers++;
      return markers;
    },
  };
  const { ad, explicitAd } = runInNewContext(
    '(() => { ' + snippet + '\nreturn { ad, explicitAd }; })()',
    {
      player,
      duration: () => length,
      text: element => element.label,
      visible: element => {
        counts.visibility++;
        return element.visible !== false;
      },
    },
  );
  return { ad, explicitAd, counts };
}

test('healthy long-form TVer media skips geometry checks for unrelated controls', () => {
  const ordinary = Array.from({ length: 50 }, (_, i) =>
    ({ label: 'player control ' + i, visible: true }));
  const fallback = Array.from({ length: 20 }, (_, i) =>
    ({ label: 'other component ' + i, visible: true }));
  const scene = scenario({ controls: ordinary, markers: fallback });
  assert.equal(scene.ad(), false);
  assert.equal(scene.counts.controls, 1);
  assert.equal(scene.counts.markers, 1);
  assert.equal(scene.counts.visibility, 0);
  // This path is also reached from video timeupdate handlers.
  assert.match(expanded, /event\.type === 'timeupdate'[\s\S]*?!ad\(\)/);
});

test('short TVer pre-roll is an ad without querying controls or layout', () => {
  const scene = scenario({ length: 8 });
  assert.equal(scene.ad(), true);
  assert.deepEqual(scene.counts, { controls: 0, markers: 0, visibility: 0 });
});

test('visible skip button is recognized while hidden skip is rejected', () => {
  const visible = scenario({
    controls: [
      { label: '設定' },
      { label: '広告をスキップ', visible: true },
    ],
  });
  assert.equal(visible.ad(), true);
  assert.equal(visible.counts.visibility, 1);
  assert.equal(visible.counts.markers, 0);

  const hidden = scenario({
    controls: [{ label: '広告をスキップ', visible: false }],
  });
  assert.equal(hidden.ad(), false);
  assert.equal(hidden.counts.visibility, 1);
});

test('fallback commercial labels retain their visibility guard', () => {
  const ignored = scenario({
    markers: [
      { label: 'Unrelated playlist', visible: true },
      { label: 'CM 30秒', visible: false },
    ],
  });
  assert.equal(ignored.ad(), false);
  assert.equal(ignored.counts.visibility, 1);
  const marked = scenario({
    markers: [{ label: 'CM 30秒', visible: true }],
  });
  assert.equal(marked.ad(), true);
  assert.equal(marked.counts.visibility, 1);
});

test('ad checks do not copy NodeLists or force full-page scans', () => {
  assert.doesNotMatch(snippet, /Array\.from\(/);
  assert.match(snippet, /player\.querySelectorAll\(controlSelector\)/);
  assert.match(snippet, /player\.querySelectorAll\(selectors\.join\(','\)\)/);
  assert.doesNotMatch(snippet, /document\.querySelectorAll/);
});
