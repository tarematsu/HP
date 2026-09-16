import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = name => readFileSync(
  new URL(`../../native/src/renderer_panels/${name}`, import.meta.url), 'utf8');

const host = source('media_host.inc');
const youtubePolicy = source('media_youtube_control_recovery.inc');

const section = (text, start, end) => {
  const from = text.indexOf(start);
  const to = text.indexOf(end, from + start.length);
  assert.ok(from >= 0, `missing section start: ${start}`);
  assert.ok(to > from, `missing section end: ${end}`);
  return text.slice(from, to);
};

test('YouTube policy returns exact CSS coordinates for trusted controls', () => {
  assert.match(youtubePolicy, /const rect = element\.getBoundingClientRect/);
  assert.match(
    youtubePolicy,
    /const x = Number\(rect\?\.left\) \+ Number\(rect\?\.width\) \/ 2/,
  );
  assert.match(
    youtubePolicy,
    /const y = Number\(rect\?\.top\) \+ Number\(rect\?\.height\) \/ 2/,
  );
  assert.match(youtubePolicy, /return \[point\.x, point\.y\]/);
  assert.doesNotMatch(
    youtubePolicy,
    /point\.x \/ window\.innerWidth|point\.y \/ window\.innerHeight/,
  );
});

test('YouTube trusted clicks consume CSS coordinates and dispatch directly through CDP', () => {
  const direct = section(
    host,
    'void DispatchYoutubeCssPoint(',
    'void ProbeYoutubeWatchdog()',
  );
  assert.match(direct, /Input\.dispatchMouseEvent/);
  assert.match(direct, /mouseMoved[\s\S]*mousePressed[\s\S]*mouseReleased/);
  assert.doesNotMatch(
    direct,
    /ClientToScreen|ScreenToClient|MOUSEEVENTF_|GetDpiForWindow|get_ZoomFactor|get_RasterizationScale|window\.innerWidth|window\.innerHeight/,
  );
});

test('YouTube watchdog no longer uses the Windows-coordinate trusted-input path', () => {
  const youtube = section(
    host,
    'void ProbeYoutubeWatchdog()',
    'void ProbeTverWatchdog()',
  );
  assert.match(youtube, /ParseCssPoint\(json, &cssX, &cssY\)/);
  assert.match(
    youtube,
    /DispatchYoutubeCssPoint\(requestView\.Get\(\), cssX, cssY\)/,
  );
  assert.doesNotMatch(
    youtube,
    /ParseNormalizedPoint|ClickNormalizedPoint|ClickYoutubeNormalizedPoint/,
  );
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
  assert.match(tver, /ParseNormalizedPoint\(json, &x, &y\)/);
  assert.match(tver, /ClickNormalizedPoint\(x, y\)/);
  assert.match(host, /NativeMediaDispatchTrustedInput/);
});
