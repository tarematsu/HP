import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = name => readFileSync(
  new URL(`../../native/src/${name}`, import.meta.url),
  'utf8',
);

const player = source('sh.cpp');
const webview = source('sh_webview.cpp');
const lifecycle = source('sh_runtime_lifecycle_script.h');
const periodic = source('sh_track_boundary_message_policy.h');

test('Stationhead does not promote a native-audio pulse to healthy playback', () => {
  const gate = player.indexOf(
    'if (playing &&\n      source != L"WebView2 + media clock" &&\n      source != L"media clock")',
  );
  const exchange = player.indexOf('audioPlaying_.exchange(playing');
  assert.notEqual(gate, -1);
  assert.notEqual(exchange, -1);
  assert.ok(gate < exchange);
  assert.match(player, /window\.__homepanelAudioPlaying = false/);

  // Existing native-positive sources still flow through the single gate rather
  // than gaining special recovery bypasses.
  assert.match(webview, /ApplyAudioPlaybackState\(playing != FALSE, L"WebView2"\)/);
  assert.match(webview, /ApplyAudioPlaybackState\(playing != FALSE, L"WebView2 initial"\)/);
  assert.match(periodic, /ApplyAudioPlaybackState\(playing, L"1-minute native audio health check"\)/);
  assert.match(player, /L"post-navigation native confirmation"/);
});

test('Stationhead requires same-media clock advancement before native confirmation', () => {
  const baseline = lifecycle.indexOf('else if (progressMedia !== media)');
  const progress = lifecycle.indexOf('else if (current > progressTime + 0.10)');
  assert.notEqual(baseline, -1);
  assert.notEqual(progress, -1);
  assert.ok(baseline < progress);
  assert.match(lifecycle, /postText\('media-progress'\)/);
  assert.match(
    lifecycle,
    /window\.__homepanelAudioPlaying !== true[\s\S]*postText\('media-progress'\)/,
  );
});

test('Stationhead media-progress confirmation rechecks WebView2 audio fail-closed', () => {
  assert.match(webview, /message == prefix \+ L"-media-progress"/);
  assert.match(webview, /get_IsDocumentPlayingAudio\([\s\S]*&nativePlaying/);
  assert.match(
    webview,
    /nativePlaying != FALSE[\s\S]*L"WebView2 \+ media clock"/,
  );
  assert.match(webview, /L"media clock without native audio"/);
  assert.match(player, /source != L"WebView2 \+ media clock"/);
  assert.match(player, /source != L"media clock"/);
});

test('Stationhead track-boundary recovery stays armed after an unverified native pulse', () => {
  const postNavigation = player.indexOf('L"post-navigation native confirmation"');
  const verifiedCheck = player.indexOf(
    'if (!audioPlaying_.load(std::memory_order_relaxed))',
    postNavigation,
  );
  const deadline = player.indexOf(
    'nowMs + kStationheadTrackBoundaryPlaybackRecoveryTimeoutMs',
    verifiedCheck,
  );
  assert.notEqual(postNavigation, -1);
  assert.notEqual(verifiedCheck, -1);
  assert.notEqual(deadline, -1);
  assert.ok(postNavigation < verifiedCheck && verifiedCheck < deadline);
});

test('Stationhead recovery verification does not reintroduce PCM or Core Audio peak checks', () => {
  for (const text of [player, webview, lifecycle]) {
    assert.doesNotMatch(text, /IAudioMeterInformation/);
    assert.doesNotMatch(text, /GetPeakValue/);
    assert.doesNotMatch(text, /PCM peak/i);
  }
});
