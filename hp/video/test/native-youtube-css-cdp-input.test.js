import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = name => readFileSync(
  new URL(`../../native/src/renderer_panels/${name}`, import.meta.url), 'utf8');

const host = source('media_host.inc');

const section = (text, start, end) => {
  const from = text.indexOf(start);
  const to = text.indexOf(end, from + start.length);
  assert.ok(from >= 0, `missing section start: ${start}`);
  assert.ok(to > from, `missing section end: ${end}`);
  return text.slice(from, to);
};

test('YouTube trusted clicks project to CSS and dispatch directly through CDP', () => {
  const direct = section(
    host,
    'void DispatchYoutubeCssPoint(',
    'void ProbeYoutubeWatchdog()',
  );
  assert.match(direct, /window\.innerWidth/);
  assert.match(direct, /window\.innerHeight/);
  assert.match(direct, /ParseCssPoint\(json, &cssX, &cssY\)/);
  assert.match(direct, /Input\.dispatchMouseEvent/);
  assert.match(direct, /mouseMoved[\s\S]*mousePressed[\s\S]*mouseReleased/);
  assert.doesNotMatch(
    direct,
    /ClientToScreen|ScreenToClient|MOUSEEVENTF_|GetDpiForWindow|get_ZoomFactor|get_RasterizationScale/,
  );
});

test('YouTube watchdog no longer uses the Windows-coordinate trusted-input path', () => {
  const youtube = section(
    host,
    'void ProbeYoutubeWatchdog()',
    'void ProbeTverWatchdog()',
  );
  assert.match(youtube, /ClickYoutubeNormalizedPoint\(x, y\)/);
  assert.doesNotMatch(youtube, /ClickNormalizedPoint\(x, y\)/);
});

test('a clipped 1x1 media host keeps a full WebView viewport', () => {
  const resize = section(host, 'void Resize() noexcept', 'bool OnTimer(');
  assert.match(resize, /width <= 1 \|\| height <= 1/);
  assert.match(resize, /HomePanelNativeSpotifyStatus/);
  assert.match(resize, /parentClient\.right - parentClient\.left/);
  assert.match(resize, /parentClient\.bottom - videoTop/);
  assert.match(resize, /controller_->put_Bounds\(client\)/);
});

test('TVer retains the existing native-coordinate compatibility path', () => {
  const tver = section(
    host,
    'void ProbeTverWatchdog()',
    'static LONG AbsoluteMouseCoordinate',
  );
  assert.match(tver, /ClickNormalizedPoint\(x, y\)/);
  assert.match(host, /NativeMediaDispatchTrustedInput/);
});
