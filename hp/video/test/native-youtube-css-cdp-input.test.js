import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = name => readFileSync(
  new URL(`../../native/src/renderer_panels/${name}`, import.meta.url), 'utf8');

const host = source('media_host.inc');
const youtubePolicy = source('media_youtube_control_recovery.inc');
const tverPolicy = source('media_tver_playback_policy_main1.inc');

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

test('TVer policy returns exact CSS coordinates for trusted controls', () => {
  assert.match(tverPolicy, /const rect = visibleRect\(element\)/);
  assert.match(tverPolicy, /const centerX = rect\.left \+ rect\.width \/ 2/);
  assert.match(tverPolicy, /const centerY = rect\.top \+ rect\.height \/ 2/);
  assert.match(tverPolicy, /return \[centerX, centerY\]/);
  assert.doesNotMatch(
    tverPolicy,
    /centerX \/ window\.innerWidth|centerY \/ window\.innerHeight/,
  );
});

test('YouTube and TVer trusted clicks share direct CSS-to-CDP input', () => {
  const direct = section(
    host,
    'void DispatchMediaCssPoint(',
    'void ProbeYoutubeWatchdog()',
  );
  assert.match(direct, /Input\.dispatchMouseEvent/);
  assert.match(direct, /mouseMoved[\s\S]*mousePressed[\s\S]*mouseReleased/);
  assert.match(direct, /runTverPostClick/);
  assert.match(direct, /kNativeMediaTverForceFullscreenAdSafeScript/);
  assert.doesNotMatch(
    direct,
    /ClientToScreen|ScreenToClient|MOUSEEVENTF_|GetDpiForWindow|get_ZoomFactor|get_RasterizationScale|window\.innerWidth|window\.innerHeight/,
  );
});

test('YouTube watchdog uses the shared CSS path without native coordinate conversion', () => {
  const youtube = section(
    host,
    'void ProbeYoutubeWatchdog()',
    'void ProbeTverWatchdog()',
  );
  assert.match(youtube, /ParseCssPoint\(json, &cssX, &cssY\)/);
  assert.match(
    youtube,
    /DispatchMediaCssPoint\(requestView\.Get\(\), cssX, cssY, false\)/,
  );
  assert.doesNotMatch(
    youtube,
    /ParseNormalizedPoint|ClickNormalizedPoint|ClickYoutubeNormalizedPoint/,
  );
});

test('TVer watchdog uses the same shared CSS path with TVer post-click handling', () => {
  const tver = section(
    host,
    'void ProbeTverWatchdog()',
    'static LONG AbsoluteMouseCoordinate',
  );
  assert.match(tver, /ParseCssPoint\(json, &cssX, &cssY\)/);
  assert.match(
    tver,
    /DispatchMediaCssPoint\(requestView\.Get\(\), cssX, cssY, true\)/,
  );
  assert.doesNotMatch(tver, /ParseNormalizedPoint|ClickNormalizedPoint\(x, y\)/);
});

test('a clipped 1x1 media host keeps a full WebView viewport', () => {
  const resize = section(host, 'void Resize() noexcept', 'bool OnTimer(');
  assert.match(resize, /width <= 1 \|\| height <= 1/);
  assert.match(resize, /HomePanelNativeSpotifyStatus/);
  assert.match(resize, /parentClient\.right - parentClient\.left/);
  assert.match(resize, /parentClient\.bottom - videoTop/);
  assert.match(resize, /controller_->put_Bounds\(client\)/);
});
