import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(
  new URL('../../native/src/renderer_panels/media_youtube_control_recovery.inc', import.meta.url),
  'utf8',
);
const runtime = [...source.matchAll(/LR"JS\(([\s\S]*?)\)JS"/g)]
  .map(([, part]) => part).join('');
const start = runtime.indexOf('  // Reuse the stable player root');
const end = runtime.indexOf('  if (!player) {', start);
assert.ok(start >= 0 && end > start, 'cached player source must exist');
const select = runtime.slice(start, end);

function scenario() {
  let current = null;
  let queries = 0;
  const state = {};
  const document = {
    querySelector(selector) {
      assert.equal(selector, '#movie_player');
      queries++;
      return current;
    },
  };
  return {
    state,
    setCurrent: value => { current = value; },
    reads: () => queries,
    select() {
      return vm.runInNewContext(
        '(() => { ' + select + '\nreturn player; })()',
        { state, document },
      );
    },
  };
}

test('YouTube caches a connected movie player for hundreds of ad wakeups', () => {
  const scene = scenario();
  const player = { id: 'movie_player', isConnected: true };
  scene.setCurrent(player);
  assert.equal(scene.select(), player);
  assert.equal(scene.reads(), 1);
  scene.state.player = player;
  for (let i = 0; i < 500; i++) assert.equal(scene.select(), player);
  assert.equal(scene.reads(), 1, 'steady ad wakeups should not query the document');
});

test('SPA navigation invalidates a connected old player without losing the new one', () => {
  const scene = scenario();
  const original = { id: 'movie_player', isConnected: true };
  const replacement = { id: 'movie_player', isConnected: true };
  scene.state.player = original;
  scene.setCurrent(replacement);
  assert.equal(scene.select(), original, 'connected cache remains valid before navigation');
  assert.equal(scene.reads(), 0);
  scene.state.playerNeedsRefresh = true;
  assert.equal(scene.select(), replacement);
  assert.equal(scene.reads(), 1);
  assert.equal(scene.state.playerNeedsRefresh, false);
  scene.state.player = replacement;
  assert.equal(scene.select(), replacement);
  assert.equal(scene.reads(), 1, 'new player is cached after ownership changes');
});

test('detachment, unexpected identity, and missing player fall back to the DOM', () => {
  const scene = scenario();
  const original = { id: 'movie_player', isConnected: false };
  const replacement = { id: 'movie_player', isConnected: true };
  scene.state.player = original;
  scene.setCurrent(replacement);
  assert.equal(scene.select(), replacement);
  assert.equal(scene.reads(), 1);

  scene.state.player = { id: 'unrelated', isConnected: true };
  assert.equal(scene.select(), replacement);
  assert.equal(scene.reads(), 2);
  scene.state.player = replacement;
  replacement.isConnected = false;
  scene.setCurrent(null);
  assert.equal(scene.select(), null);
  assert.equal(scene.reads(), 3);
  scene.state.playerNeedsRefresh = true;
  assert.equal(scene.select(), null);
  assert.equal(scene.reads(), 4, 'unavailable player is re-queried for recovery');
  assert.equal(scene.state.playerNeedsRefresh, false);
});

test('SPA microtask invalidates the player cache before watchdog dispatch', () => {
  assert.match(runtime,
    /queueMicrotask\(\(\) => \{[\s\S]*state\.playerNeedsRefresh = true;[\s\S]*bindVideo\(true\);[\s\S]*wake\(0\)/);
});
