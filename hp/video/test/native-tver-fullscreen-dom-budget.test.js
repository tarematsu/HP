import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const native = readFileSync(
  new URL('../../native/src/renderer_panels/media_section.inc', import.meta.url),
  'utf8');
const begin = native.indexOf('void NativeMediaRequestTverBrowserFullscreen(');
const end = native.indexOf('void NativeMediaDispatchFullscreenKey(', begin);
assert.ok(begin >= 0 && end > begin);
const fullscreen = native.slice(begin, end);
const raw = fullscreen.match(/static constexpr wchar_t kRequest\[\] = LR"JSON\(([\s\S]*?)\)JSON"/)?.[1];
assert.ok(raw, 'TVer user-gesture CDP expression must exist');
const request = JSON.parse(raw);

async function checkFullscreen({ videos = [], initiallyFullscreen = false } = {}) {
  let styleReads = 0;
  const doc = {
    fullscreenElement: initiallyFullscreen ? {} : null,
    querySelectorAll(selector) {
      assert.equal(selector, 'video');
      return videos;
    },
  };
  let fullscreenRequests = 0;
  for (const [index, video] of videos.entries()) {
    video.closest = () => null;
    video.parentElement = null;
    video.requestFullscreen = () => {
      fullscreenRequests++;
      doc.fullscreenElement = video;
      return Promise.resolve();
    };
    video.getBoundingClientRect ??= () => ({
      width: index === 0 ? 0 : 320,
      height: index === 0 ? 0 : 180,
    });
  }
  const result = await runInNewContext(request.expression, {
    document: doc,
    getComputedStyle: () => {
      styleReads++;
      return { display: 'block', visibility: 'visible' };
    },
  });
  return { result, styleReads, fullscreenRequests, selected: doc.fullscreenElement };
}

test('TVer fullscreen retains trusted CDP gesture and native keyboard fallback', () => {
  assert.equal(request.userGesture, true);
  assert.equal(request.awaitPromise, true);
  assert.equal(request.returnByValue, true);
  assert.match(fullscreen, /NativeMediaDispatchFullscreenKeyEvents\(view\.Get\(\), true\)/);
  assert.match(fullscreen, /kNativeMediaTverForceFullscreenAdSafeScript/);
});

test('one TVer video skips all synchronous DOM geometry and style reads', async () => {
  const oneVideo = {
    getBoundingClientRect() { throw new Error('single-video path must not force layout'); },
  };
  const result = await checkFullscreen({ videos: [oneVideo] });
  assert.equal(result.result, true);
  assert.equal(result.fullscreenRequests, 1);
  assert.equal(result.styleReads, 0);
  assert.equal(result.selected, oneVideo);
});

test('multiple TVer videos still prefer the first visible video', async () => {
  const hidden = { getBoundingClientRect: () => ({ width: 0, height: 0 }) };
  const visible = { getBoundingClientRect: () => ({ width: 640, height: 360 }) };
  const result = await checkFullscreen({ videos: [hidden, visible] });
  assert.equal(result.result, true);
  assert.equal(result.selected, visible);
  assert.equal(result.fullscreenRequests, 1);
  assert.equal(result.styleReads, 2);
});

test('empty TVer page safely skips fullscreen', async () => {
  const result = await checkFullscreen();
  assert.equal(result.result, false);
  assert.equal(result.fullscreenRequests, 0);
});
