import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const composition = readFileSync(
  new URL('../../native/src/renderer_panels.cpp', import.meta.url),
  'utf8',
);
const mediaPanel = readFileSync(
  new URL('../../native/src/renderer_panels/media_section.inc', import.meta.url),
  'utf8',
);

test('TVer skips the expensive controls scan during stable low-quality playback', () => {
  assert.match(composition, /state\.video !== video/);
  assert.match(composition, /state\.lowQualitySet = false/);
  assert.match(
    composition,
    /const stablePlayback = video && !video\.paused && !video\.ended &&[\s\S]*state\.lowQualitySet/,
  );
  assert.match(composition, /if \(stablePlayback\) return/);
  assert.match(
    composition,
    /if \(stablePlayback\) return;[\s\S]*const controls = Array\.from\(document\.querySelectorAll/,
  );
});

test('YouTube health work is folded into the existing watchdog', () => {
  assert.match(composition, /kNativeMediaYoutubeWatchdogOverrideScript/);
  assert.match(composition, /video && video\.error/);
  assert.match(composition, /player\.classList\.contains\('ytp-error'\)/);
  assert.match(
    composition,
    /location\.replace\('https:\/\/www\.youtube\.com\/playlist\?list=PLMWqSdpIVl30'\)/,
  );
  assert.match(
    composition,
    /setPlaybackQualityRange\('large', 'large'\)[\s\S]*setPlaybackQuality\('large'\)/,
  );
  assert.match(composition, /quality && quality !== 'large'/);
  assert.match(
    composition,
    /kNativeMediaPlaybackHealthTimer[\s\S]*static_cast<UINT_PTR>\(1\)/,
  );
  assert.match(
    composition,
    /Health\/error handling and 480p maintenance live in the watchdog now/,
  );
  assert.match(mediaPanel, /ProbeYoutubeHealth\(\)/);
});

test('playlist startup probes once per second and falls back after about ten attempts', () => {
  assert.match(
    composition,
    /kNativeMediaPlayAllTimer[\s\S]*\? 1000U/,
  );
  assert.match(composition, /__homePanelPlayAllProbeState/);
  assert.match(composition, /probeState\.attempts \+= 1/);
  assert.match(
    composition,
    /probeState\.attempts >= 10 \? \[5850, 4250\] : null/,
  );
});

test('YouTube quality remains 480p rather than changing the requested resolution', () => {
  assert.match(mediaPanel, /setPlaybackQualityRange\('large', 'large'\)/);
  assert.match(composition, /setPlaybackQualityRange\('large', 'large'\)/);
  assert.doesNotMatch(composition, /setPlaybackQualityRange\('medium'/);
  assert.doesNotMatch(composition, /setPlaybackQualityRange\('small'/);
});
