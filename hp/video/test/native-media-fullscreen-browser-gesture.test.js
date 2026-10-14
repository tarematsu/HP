import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const native = read('../../native/src/renderer_panels/media_section.inc');
const youtube = read('../../native/src/renderer_panels/media_youtube_control_recovery.inc');
const tverSettings = read('../../native/src/renderer_panels/media_tver_current_player_settings.inc');
const tverRuntime = read('../../native/src/renderer_panels/media_tver_control_recovery.inc');

const youtubeSection = native.slice(
  native.indexOf('void NativeMediaRequestYoutubeBrowserFullscreen('),
  native.indexOf('void NativeMediaDispatchFullscreenKey(', native.indexOf('void NativeMediaRequestYoutubeBrowserFullscreen(')),
);
const requestJson = youtubeSection.match(/static constexpr wchar_t kRequest\[\] = LR"JSON\(([\s\S]*?)\)JSON"/)?.[1];
assert.ok(requestJson, 'YouTube trusted browser request must exist');
const request = JSON.parse(requestJson);

test('YouTube native fullscreen calls the DOM API using a trusted CDP user gesture', async () => {
  assert.equal(request.userGesture, true);
  assert.equal(request.awaitPromise, true);
  assert.equal(request.returnByValue, true);
  assert.match(native, /NativeMediaRequestYoutubeBrowserFullscreen\(webview\)/);
  const document = { fullscreenElement: null };
  let calls = 0;
  const player = {
    requestFullscreen() {
      calls++;
      document.fullscreenElement = player;
      return Promise.resolve();
    },
  };
  document.querySelector = selector => selector === '#movie_player' ? player : null;
  const evaluate = () => vm.runInNewContext(request.expression, {
    document, location: { hostname: 'www.youtube.com', pathname: '/watch' },
  });
  assert.equal(await evaluate(), true);
  assert.equal(calls, 1);
  assert.equal(await evaluate(), true, 'already fullscreen must not toggle or request again');
  assert.equal(calls, 1);
});

test('YouTube rejected browser requests safely fall back to keyboard and stay retryable', async () => {
  const player = { requestFullscreen: () => Promise.reject(new Error('blocked')) };
  const result = await vm.runInNewContext(request.expression, {
    document: { fullscreenElement: null, querySelector: () => player },
    location: { hostname: 'www.youtube.com', pathname: '/watch' },
  });
  assert.equal(result, false);
  assert.match(youtubeSection, /NativeMediaDispatchYoutubeFullscreenFallbackKey/);
  assert.match(native, /std::wstring_view\(json\) == L"true"/);
  const fallback = native.slice(
    native.indexOf('void NativeMediaDispatchYoutubeFullscreenFallbackKey('),
    native.indexOf('void NativeMediaRequestYoutubeBrowserFullscreen('),
  );
  assert.match(fallback, /document\.fullscreenElement/);
  assert.match(fallback, /return false;/);
  assert.match(youtube, /age >= 6000/);
  assert.match(youtube, /if \(age < 1200\)/);
  assert.match(youtube, /document\.webkitFullscreenElement/);
  assert.doesNotMatch(youtube, /document\.fullscreenElement \|\| player\.classList\.contains\('ytp-fullscreen'\)/);
});

test('TVer only treats real fullscreen control clicks as fullscreen activation', () => {
  assert.doesNotMatch(tverSettings, /state\.fullscreenCornerTapAt = now/);
  assert.match(tverSettings, /state\.fullscreenCornerTapAt = 0/);
  const start = tverRuntime.indexOf('const requestFullscreen = () =>');
  const end = tverRuntime.indexOf('const bindVideo = () =>', start);
  const requestRuntime = tverRuntime.slice(start, end);
  assert.match(requestRuntime, /arm\(element, 'fullscreen', 1400\)/);
  assert.match(requestRuntime, /state\.fullscreenCornerTapAt = now/);
});
