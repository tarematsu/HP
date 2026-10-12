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

const section = (start, end) => {
  const begin = runtime.indexOf(start);
  const finish = runtime.indexOf(end, begin + start.length);
  assert.ok(begin >= 0 && finish > begin);
  return runtime.slice(begin, finish);
};

function wakeScenario() {
  const code = section('  const postWake = () => {', '  const recheck =');
  const messages = [];
  const timers = new Map();
  let now = 1000;
  let nextTimerId = 1;
  let scheduled = 0;
  let cancelled = 0;
  const state = {};
  const { wake } = vm.runInNewContext(
    '(() => { ' + code + '\nreturn { wake }; })()',
    {
      state,
      window: { chrome: { webview: { postMessage: value => messages.push(value) } } },
      Date: class extends Date { static now() { return now; } },
      setTimeout: (callback, delay) => {
        const id = nextTimerId++;
        timers.set(id, { callback, due: now + delay });
        scheduled++;
        return id;
      },
      clearTimeout: id => {
        if (timers.delete(id)) cancelled++;
      },
    },
  );
  return {
    wake, state, messages,
    counts: () => ({ scheduled, cancelled, pending: timers.size }),
    advance(ms) {
      now += ms;
      for (const [id, timer] of [...timers]) {
        if (timer.due <= now) {
          timers.delete(id);
          timer.callback();
        }
      }
    },
  };
}

test('YouTube DOM bursts reuse the earliest pending wake instead of reallocating timers', () => {
  const scene = wakeScenario();
  scene.wake(80);
  for (let i = 0; i < 100; i++) scene.wake(80);
  assert.deepEqual(scene.counts(), { scheduled: 1, cancelled: 0, pending: 1 });
  scene.advance(80);
  assert.deepEqual(scene.messages, ['homepanel:youtube-wake']);
  assert.equal(scene.state.wakeTimer, null);
  assert.equal(scene.state.wakeDueAt, 0);
});

test('urgent YouTube ad wake preempts a slower recovery check without being postponed', () => {
  const scene = wakeScenario();
  scene.wake(2000);
  scene.advance(15);
  scene.wake(0);
  scene.wake(1200);
  assert.deepEqual(scene.counts(), { scheduled: 2, cancelled: 1, pending: 1 });
  scene.advance(0);
  assert.deepEqual(scene.messages, ['homepanel:youtube-wake']);
  scene.wake(80);
  scene.advance(80);
  assert.deepEqual(scene.messages, [
    'homepanel:youtube-wake', 'homepanel:youtube-wake',
  ]);
});

test('YouTube media selection is reused without a second video DOM query', () => {
  const code = section('  const bindVideo = () => {', '  const syncAdObserver =');
  let queries = 0;
  let attached = 0;
  let wakes = 0;
  const media = {
    addEventListener: () => { attached++; },
  };
  const state = {};
  const chosen = vm.runInNewContext(
    '(() => { ' + code + '\nreturn bindVideo(); })()',
    {
      state,
      player: { querySelector: () => { queries++; return media; } },
      AbortController,
      wake: () => { wakes++; },
    },
  );
  assert.equal(chosen, media);
  assert.equal(queries, 1);
  assert.equal(attached, 6);
  assert.equal(wakes, 1);
  assert.match(runtime, /const video = bindVideo\(\);/);
  assert.doesNotMatch(
    section('  const dialogAction = dismissMessageDialog();', '  const now = Date.now();'),
    /player\.querySelector\('video'\)/,
  );
});

test('YouTube SPA watch query is parsed once per URL, then refreshed on navigation', () => {
  const code = section('  const href = location.href;', '  if (state.videoKey !== videoKey)');
  const state = {};
  const location = { href: 'https://www.youtube.com/watch?v=first&list=playlistA' };
  const video = { currentSrc: 'media-source' };
  let parses = 0;
  class CountingURL extends URL {
    constructor(...args) {
      super(...args);
      parses++;
    }
  }
  const parse = () => vm.runInNewContext(
    '(() => { ' + code + '\nreturn { videoKey, playlistId }; })()',
    { state, location, video, URL: CountingURL },
  );

  for (let i = 0; i < 100; i++) {
    assert.equal(parse().videoKey, 'first');
  }
  assert.equal(parses, 1);
  location.href = 'https://www.youtube.com/watch?v=second&list=playlistB';
  const result = parse();
  assert.equal(result.videoKey, 'second');
  assert.equal(result.playlistId, 'playlistB');
  assert.equal(parses, 2);
  location.href = 'https://www.youtube.com/watch';
  assert.equal(parse().videoKey, 'media-source');
  assert.equal(parse().playlistId, '');
  assert.equal(parses, 3);
});
