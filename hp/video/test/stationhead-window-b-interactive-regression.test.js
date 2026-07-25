import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const handleHeader = readFileSync(
  new URL('../../native/src/app_stationhead_handles.h', import.meta.url),
  'utf8',
);
const appSource = readFileSync(
  new URL('../../native/src/app.cpp', import.meta.url),
  'utf8',
);
const playerSource = readFileSync(
  new URL('../../native/src/sh.cpp', import.meta.url),
  'utf8',
);
const sharedSource = readFileSync(
  new URL('../../native/src/sh_shared.h', import.meta.url),
  'utf8',
);
const webviewSource = readFileSync(
  new URL('../../native/src/sh_webview.cpp', import.meta.url),
  'utf8',
);

function section(source, start, end) {
  const startAt = source.indexOf(start);
  assert.notEqual(startAt, -1, `missing section: ${start}`);
  const endAt = source.indexOf(end, startAt + start.length);
  assert.notEqual(endAt, -1, `missing section terminator: ${end}`);
  return source.slice(startAt, endAt);
}

test('Window A and B interactive states are not exposed as reusable healthy playback', () => {
  const primaryHandle = section(
    handleHeader,
    'class AppStationheadHandle final',
    'class AppSecondaryStationheadHandle final',
  );
  assert.match(primaryHandle, /StationheadStatus Status\(\) const/);
  assert.match(
    primaryHandle,
    /status\.loginRequired \|\| status\.spotifyAuthorization \|\| status\.processFailed/,
  );
  assert.match(primaryHandle, /status\.audioPlaying = false;/);
  assert.match(primaryHandle, /status\.playing = false;/);

  const secondaryHandle = section(
    handleHeader,
    'class AppSecondaryStationheadHandle final',
    '}  // namespace hp',
  );
  assert.match(secondaryHandle, /StationheadStatus Status\(\) const/);
  assert.match(
    secondaryHandle,
    /status\.loginRequired \|\| status\.spotifyAuthorization \|\| status\.processFailed/,
  );
  assert.match(secondaryHandle, /status\.audioPlaying = false;/);
  assert.match(secondaryHandle, /status\.playing = false;/);

  const tick = section(appSource, 'void App::Tick()', 'void App::Draw()');
  assert.match(
    tick,
    /secondaryAudioPlaying,[\s\S]*renderState_\.stationhead\.secondaryPlaying/,
  );
  assert.match(tick, /secondaryStatus = secondaryStationhead_->Status\(\);/);
});

test('Window B remains constrained to its right-half placement while pending', () => {
  const placement = section(
    appSource,
    'void App::ApplyStationheadWindowPlacement(',
    'void App::PublishRenderState()',
  );
  assert.match(placement, /secondaryPending = secondaryStationhead_ && !secondaryStatus\.playing;/);
  assert.match(
    placement,
    /secondaryStationhead_->SetBounds\(secondaryPending \? right : bounds\);/,
  );
  assert.match(placement, /secondaryStationhead_->RefreshVisibility\(\);/);
});

test('Window A and B keep confirmed login-required state while audio continues', () => {
  const applyAudio = section(
    playerSource,
    'void StationheadPlayer::ApplyAudioPlaybackState(',
    'void StationheadPlayer::NavigateCurrentUrl(',
  );
  assert.match(applyAudio, /preserveLoginRequired = loginRequired_/);
  assert.match(applyAudio, /status_\.loginRequired = preserveLoginRequired;/);
  assert.match(applyAudio, /if \(!preserveLoginRequired && !startupPreviewActive_/);
  assert.match(applyAudio, /Stationhead login required; audio continues/);
  assert.match(
    applyAudio,
    /PostChange\(preserveLoginRequired \? StationheadChangeNone[\s\S]*StationheadChangeReturnMain\)/,
  );
});

test('Window B rejects auth-probe results from an obsolete local execution', () => {
  const taggedProbe = section(
    playerSource,
    'std::wstring StationheadAuthProbeScriptForRun(',
    '}\n}\n\nStationheadPlayer::StationheadPlayer(',
  );
  assert.match(taggedProbe, /StationheadAuthProbeScript\(channelId\)/);
  assert.doesNotMatch(taggedProbe, /StationheadAuthProbeScriptNetwork/);
  assert.match(taggedProbe, /probe_started_at/);
  assert.match(taggedProbe, /std::to_wstring\(probeStartedAt\)/);
  assert.match(taggedProbe, /script\.replace\(at, marker\.size\(\), replacement\)/);

  const poll = section(
    playerSource,
    'void StationheadPlayer::PollAuthProbe(',
    '// Locates the Start Listening control',
  );
  assert.match(
    poll,
    /StationheadAuthProbeScriptForRun\(config_\.channelId, authProbeStartedAt_\)/,
  );

  const navigationStart = section(
    webviewSource,
    'const HRESULT navigationStartingResult = webview_->add_NavigationStarting(',
    'if (FAILED(navigationStartingResult))',
  );
  assert.match(
    navigationStart,
    /if \(IsSecondary\(\)\)[\s\S]*authProbeInFlight_ = false;[\s\S]*authProbeStartedAt_ = 0;[\s\S]*lastAuthProbeAt_ = 0;/,
  );

  const handler = section(
    webviewSource,
    'if (type == L"stationhead-auth-probe")',
    'if (!spotifyAuthorization_',
  );
  assert.match(handler, /probeStartedAt != authProbeStartedAt_/);
  assert.match(handler, /ignored a stale auth probe result/);
  assert.match(handler, /state == L"forbidden"/);
  assert.match(handler, /playback session retained/);
});

test('login detection rejects the captured token and is re-armed after new authentication', () => {
  const autoplay = section(
    sharedSource,
    'inline std::wstring StationheadAutoplayScript(',
    'inline std::wstring StationheadVolumeScript(',
  );
  assert.match(autoplay, /const rejectCapturedAuth = \(\) =>/);
  assert.match(
    autoplay,
    /__homepanelStationheadRejectedAuthorization = authorization;[\s\S]*__homepanelStationheadAuthHeaders = null;/,
  );
  const rejectAt = autoplay.indexOf('rejectCapturedAuth();');
  const reportAt = autoplay.indexOf("postMessage('{{PREFIX}}-login-required')");
  assert.ok(rejectAt >= 0 && reportAt > rejectAt);
  assert.match(
    autoplay,
    /addEventListener\('homepanel-stationhead-auth-ready',[\s\S]*loginReported = false;[\s\S]*scheduleUnlessPlaying\(0\);/,
  );

  const authCapture = section(
    sharedSource,
    'inline std::wstring StationheadAuthCaptureScript()',
    'inline std::wstring StationheadApiPlayStatsScript(',
  );
  const resetAt = authCapture.indexOf("dispatchEvent(new Event('homepanel-stationhead-auth-ready'))");
  const readyAt = authCapture.indexOf("postMessage({ type: 'stationhead-auth-ready' })");
  assert.ok(resetAt >= 0 && readyAt > resetAt);
});


test('A and B continue login detection while audio remains active', () => {
  const autoplay = section(
    sharedSource,
    'inline std::wstring StationheadAutoplayScript(',
    'inline std::wstring StationheadVolumeScript(',
  );
  const publishAudio = section(
    autoplay,
    'const publishAudio = () => {',
    '// Clicking is handled natively:',
  );
  assert.doesNotMatch(publishAudio, /observer\?\.disconnect/);
  assert.doesNotMatch(publishAudio, /nativeClearTimeout/);

  const scan = section(
    autoplay,
    'const scan = () => {',
    'const schedule = (delay = 100) => {',
  );
  assert.doesNotMatch(scan, /if \(isPlaying\)[\s\S]*return;/);
  assert.match(scan, /!start && !isPlaying && startPattern\.test\(label\)/);
  const loginAt = scan.indexOf('if (login) {');
  const startAt = scan.indexOf('if (start) {');
  assert.ok(loginAt >= 0 && startAt > loginAt);

  assert.match(
    autoplay,
    /NativeMutationObserver\(records => \{[\s\S]*records\.some\(relevant\)\) schedule\(\);/,
  );
  assert.match(autoplay, /nativeTimeout\(schedule, 15000\);/);
});

test('Window A schedules failed stats execution and auth errors for a real 30-second retry', () => {
  const pollStats = section(
    playerSource,
    'void StationheadPlayer::PollDailyPlayStats(',
    'void StationheadPlayer::PollAuthProbe(',
  );
  assert.match(pollStats, /const HRESULT result = webview_->ExecuteScript/);
  assert.match(pollStats, /if \(FAILED\(result\)\)/);
  assert.match(
    pollStats,
    /nowMs - \(kStationheadDailyPlayStatsIntervalMs -[\s\S]*kStationheadDailyPlayStatsRetryMs\)/,
  );
  assert.match(
    pollStats,
    /nextTickAt_ = nowMs \+ kStationheadDailyPlayStatsRetryMs;/,
  );

  const retryBackdates = webviewSource.match(
    /lastDailyPlayStatsAt_ =[\s\S]*?kStationheadDailyPlayStatsIntervalMs -[\s\S]*?kStationheadDailyPlayStatsRetryMs/g,
  ) || [];
  assert.equal(retryBackdates.length, 2);
  assert.doesNotMatch(webviewSource, /lastDailyPlayStatsAt_ = now;[\s\S]*kDailyPlayStatsRetryMs/);
});

test('Spotify authorization clears both internal and published login-required state', () => {
  const openAuth = section(
    playerSource,
    'void StationheadPlayer::OpenSpotifyAuthorization(',
    'void StationheadPlayer::FinishSpotifyAuthorization(',
  );
  assert.match(openAuth, /loginRequired_ = false;/);
  assert.match(openAuth, /status_\.loginRequired = false;/);
});
