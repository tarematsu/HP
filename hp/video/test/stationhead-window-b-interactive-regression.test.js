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

test('Window B interactive state is not exposed as reusable healthy playback', () => {
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

test('Window B keeps confirmed login-required state while audio continues', () => {
  const applyAudio = section(
    playerSource,
    'void StationheadPlayer::ApplyAudioPlaybackState(',
    'void StationheadPlayer::NavigateCurrentUrl(',
  );
  assert.match(applyAudio, /preserveSecondaryLogin = IsSecondary\(\) && loginRequired_/);
  assert.match(applyAudio, /status_\.loginRequired = preserveSecondaryLogin;/);
  assert.match(applyAudio, /if \(!preserveSecondaryLogin && !startupPreviewActive_/);
  assert.match(
    applyAudio,
    /PostChange\(preserveSecondaryLogin \? StationheadChangeNone[\s\S]*StationheadChangeReturnMain\)/,
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
