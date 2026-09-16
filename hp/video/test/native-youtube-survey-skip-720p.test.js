import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const clean = read('../../native/src/renderer_panels/media_youtube_policy.inc');
const runtime = read('../../native/src/renderer_panels/media_youtube_control_recovery.inc');
const reliablePlayAll = read('../../native/src/renderer_panels/media_youtube_playall_reliable.inc');
const composition = read('../../native/src/renderer_panels/media_section.inc');
const mediaBase = read('../../native/src/renderer_panels/media_section_base.inc');
const trustedInput = read('../../native/src/renderer_panels/media_trusted_input.inc');

test('YouTube startup normally lands on cloud-resolved watch item', () => {
  assert.match(mediaBase, /homepanel-cloud\.tarematsu\.workers\.dev\/v1\/native\/youtube-start/);
  assert.match(reliablePlayAll, /ytd-playlist-video-renderer a#thumbnail/);
  assert.match(reliablePlayAll, /url\.searchParams\.set\('list', list\)/);
  assert.match(reliablePlayAll, /location\.assign\(url\.href\)/);
  assert.match(mediaBase, /kNativeMediaPlayAllScript = kNativeMediaYoutubeReliablePlayAllScript/);
});

test('paused playback recovers through direct play then trusted Play', () => {
  assert.match(runtime, /video\?\.paused && !video\.ended/);
  assert.match(runtime, /video\.play\(\)\?\.catch/);
  assert.match(runtime, /arm\(player\.querySelector\('\.ytp-play-button'\), 'play', 1500\)/);
  assert.match(trustedInput, /Input\.dispatchMouseEvent/);
});

test('YouTube surveys stay inside active ad handling', () => {
  const adStart = runtime.indexOf('if (ad()) {');
  const survey = runtime.indexOf('for (const root of player.querySelectorAll', adStart);
  const content = runtime.indexOf('const currentTime = Number(video?.currentTime);');
  assert.ok(adStart >= 0 && survey > adStart && content > survey);
  assert.match(runtime, /arm\(option, 'survey-option', 500\)/);
  assert.match(runtime, /arm\(submit, 'survey-submit', 500\)/);
});

test('ad skip and fullscreen recover hidden controls without a fixed wait', () => {
  assert.match(runtime, /arm\(target, 'skip-ad', 600\)/);
  assert.match(runtime, /arm\(canonical, 'fullscreen', 1200\)/);
  assert.match(runtime, /return arm\(fallback, 'fullscreen', 1200\)/);
  assert.doesNotMatch(runtime, /fullscreenSettleMs|fullscreenReadyAt|adFullscreenReadyAt/);
  assert.match(runtime, /getBoundingClientRect\?\.\(\)/);
  assert.match(runtime, /document\.elementFromPoint\(point\.x, point\.y\)/);
  assert.match(runtime, /position:fixed!important/);
  assert.match(runtime, /return \[point\.x, point\.y\]/);
  assert.doesNotMatch(runtime, /point\.x \/ window\.innerWidth/);
  assert.doesNotMatch(runtime, /point\.y \/ window\.innerHeight/);
  assert.doesNotMatch(runtime, /return \[5000, 5000\]/);
  assert.doesNotMatch(runtime, /requestFullscreen|webkitRequestFullscreen/);
});

test('skippable ad click is not blocked by fullscreen recovery', () => {
  const adStart = runtime.indexOf('if (ad()) {');
  const skip = runtime.indexOf("arm(target, 'skip-ad', 600)", adStart);
  const fullscreen = runtime.indexOf('const action = armFullscreen();', adStart);
  assert.ok(adStart >= 0 && skip > adStart && fullscreen > skip);
});

test('content settings remain one-shot per video at 360p with captions off', () => {
  assert.match(runtime, /videoKey/);
  assert.match(runtime, /qualityApplied: false/);
  assert.match(runtime, /captionsApplied: false/);
  assert.match(runtime, /const preferredQuality = 'medium'/);
  assert.match(runtime, /setPlaybackQualityRange\(preferredQuality, preferredQuality\)/);
  assert.match(runtime, /player\.setOption\('captions', 'track', \{\}\)/);
});

test('unified runtime owns event notification and recovery', () => {
  assert.match(runtime, /homepanel:youtube-wake/);
  assert.match(runtime, /attributeFilter: \['class'\]/);
  assert.match(runtime, /setPlaybackQuality/);
  assert.match(runtime, /nextVideo/);
  assert.match(composition, /#include "media_youtube_control_recovery\.inc"/);
});

test('clean player keeps useful skip UI while hiding chrome', () => {
  assert.match(clean, /#movie_player \.ytp-ad-skip-button-modern/);
  assert.match(clean, /#movie_player \.ytp-share-button/);
  assert.match(clean, /ytd-unified-share-panel-renderer/);
});
