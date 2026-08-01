import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const layoutSource = readFileSync(
  new URL('../../native/src/sh_layout.cpp', import.meta.url),
  'utf8',
);
const playerHeader = readFileSync(
  new URL('../../native/src/sh.h', import.meta.url),
  'utf8',
);
const handleSource = readFileSync(
  new URL('../../native/src/app_stationhead_handles.cpp', import.meta.url),
  'utf8',
);
const stateSource = readFileSync(
  new URL('../../native/src/app_stationhead_state.cpp', import.meta.url),
  'utf8',
);
const webviewSource = readFileSync(
  new URL('../../native/src/sh_webview.cpp', import.meta.url),
  'utf8',
);
const loggerSource = readFileSync(
  new URL('../../native/src/logger.cpp', import.meta.url),
  'utf8',
);

function section(source, start, end) {
  const startAt = source.indexOf(start);
  assert.notEqual(startAt, -1, `missing section: ${start}`);
  const endAt = source.indexOf(end, startAt + start.length);
  assert.notEqual(endAt, -1, `missing section terminator: ${end}`);
  return source.slice(startAt, endAt);
}

test('single Stationhead configuration expands the primary surface to the full parent client', () => {
  assert.match(
    layoutSource,
    /ConfiguresSecondaryStationheadWindow\(const StationheadConfig& config\)[\s\S]*config\.secondaryEnabled && !config\.secondaryUrl\.empty\(\)/,
  );
  assert.match(
    layoutSource,
    /ResolveStationheadWorkspaceBounds\([\s\S]*role == StationheadRole::Secondary[\s\S]*ConfiguresSecondaryStationheadWindow\(config\)[\s\S]*GetClientRect\(parent, &client\)/,
  );
  assert.match(
    layoutSource,
    /void StationheadPlayer::SetBounds\(const RECT& bounds\)[\s\S]*ResolveStationheadWorkspaceBounds\(role_, config_, window_, bounds\)/,
  );
});

test('hidden playback placement does not trust a stale cached visible flag', () => {
  const keepBehind = section(
    layoutSource,
    'void StationheadPlayer::KeepPlaybackBehindDashboard()',
    'void StationheadPlayer::SetStartupBounds()',
  );
  assert.doesNotMatch(
    keepBehind,
    /if \(!viewVisible_ && selectedTab_ == StationheadTabKind::None\)[\s\S]*status_\.visible/,
  );
  assert.match(
    keepBehind,
    /ApplyStationheadChildLayout\([\s\S]*bounds_, false, false\)/,
  );
});

test('child hosts are resized before WebView controller bounds are applied', () => {
  const applyLayout = section(
    layoutSource,
    'void ApplyStationheadChildLayout(',
    '\n}\n\n}\n\nbool StationheadPlayer::EnsureHostWindow()',
  );
  const hostPlacement = applyLayout.indexOf('SetWindowPos(hostWindow');
  const controllerPlacement = applyLayout.indexOf('if (controller)');
  const authHostPlacement = applyLayout.indexOf('SetWindowPos(authHostWindow');
  const authControllerPlacement = applyLayout.indexOf('if (authController)');
  assert.ok(hostPlacement >= 0 && hostPlacement < controllerPlacement);
  assert.ok(authHostPlacement >= 0 && authHostPlacement < authControllerPlacement);
});

test('failed host creation clears the public visible state', () => {
  const layoutControllers = section(
    layoutSource,
    'void StationheadPlayer::LayoutControllers()',
    'void StationheadPlayer::SetBounds(',
  );
  assert.match(
    layoutControllers,
    /if \(!EnsureHostWindow\(\)\)[\s\S]*status_\.visible = false;[\s\S]*return;/,
  );
});

test('scheduled WebView recreation and uncommitted audio are not reported as healthy playback', () => {
  const audioPlaying = section(
    playerHeader,
    '[[nodiscard]] bool AudioPlaying() const noexcept',
    '[[nodiscard]] int64_t AudioPlayingSince() const noexcept',
  );
  assert.match(audioPlaying, /audioPlayingSinceAt_\.load\(std::memory_order_acquire\)/);
  assert.match(audioPlaying, /playingSince > 0/);
  assert.match(audioPlaying, /audioPlaying_\.load\(std::memory_order_acquire\)/);
  assert.match(audioPlaying, /!recreating_\.load\(std::memory_order_acquire\)/);
  assert.match(
    playerHeader,
    /AudioPlayingSince\(\) const noexcept[\s\S]*playingSince > 0 && AudioPlaying\(\) \? playingSince : 0;/,
  );
  assert.match(
    playerHeader,
    /AtomicMonotonicElapsedTimestamp audioPlayingSinceAt_;/,
  );

  const interactive = section(
    layoutSource,
    'bool StationheadPlayer::NeedsInteractiveWindow() const',
    '}  // namespace hp',
  );
  assert.match(
    interactive,
    /selectedTab_ == StationheadTabKind::Auth \|\| spotifyAuthorization_/,
  );
  assert.doesNotMatch(interactive, /AudioPlaying\(\)|controller_/);
});

test('handle status and placement use the recreation-aware audio state', () => {
  const rawStatus = section(
    handleSource,
    'StationheadStatus StationheadHandleBase::RawStatus() const',
    'StationheadStatus StationheadHandleBase::Status() const',
  );
  assert.match(rawStatus, /player_->AudioPlaying\(\)/);
  assert.match(rawStatus, /status\.audioPlaying = audioPlaying;/);
  assert.match(rawStatus, /status\.playing = audioPlaying;/);

  const refreshVisibility = section(
    handleSource,
    'void StationheadHandleBase::RefreshVisibility()',
    'void StationheadHandleBase::Start()',
  );
  assert.match(refreshVisibility, /const StationheadStatus status = RawStatus\(\);/);

  const raiseActiveHost = section(
    handleSource,
    'void StationheadHandleBase::RaiseActiveHost() const',
    'void StationheadHandleBase::ApplyInteractiveBounds()',
  );
  assert.match(raiseActiveHost, /const StationheadStatus status = RawStatus\(\);/);
});

test('handle raises the active host without overwriting player-owned geometry', () => {
  const raiseActiveHost = section(
    handleSource,
    'void StationheadHandleBase::RaiseActiveHost() const',
    'void StationheadHandleBase::ApplyInteractiveBounds()',
  );
  assert.match(raiseActiveHost, /SetWindowPos\(host, HWND_TOP, 0, 0, 0, 0,/);
  assert.match(raiseActiveHost, /SWP_NOMOVE \| SWP_NOSIZE/);
  assert.doesNotMatch(raiseActiveHost, /const RECT activeBounds/);
  assert.doesNotMatch(raiseActiveHost, /workspaceBounds_\.right - workspaceBounds_\.left/);
});

test('secondary interactive and failure states are included in the combined render status', () => {
  const enrich = section(
    stateSource,
    'void App::EnrichRenderStationheadState(',
    'void App::ToggleStationheadAudio()',
  );
  assert.match(
    enrich,
    /state\.loginRequired = state\.loginRequired \|\| secondaryStatus->loginRequired;/,
  );
  assert.match(
    enrich,
    /state\.spotifyAuthorization =[\s\S]*state\.spotifyAuthorization \|\| secondaryStatus->spotifyAuthorization;/,
  );
  assert.match(
    enrich,
    /state\.processFailed = state\.processFailed \|\| secondaryStatus->processFailed;/,
  );
});

test('Spotify popup authorization survives playback WebView recreation without premature navigation', () => {
  assert.match(playerHeader, /std::wstring activeAuthorizationUrl_;/);
  const popup = section(
    webviewSource,
    'const HRESULT newWindowResult = webview_->add_NewWindowRequested(',
    'if (FAILED(newWindowResult))',
  );
  assert.match(popup, /CloseAuthWebView\(\);[\s\S]*activeAuthorizationUrl_ = uri;/);
  assert.doesNotMatch(popup, /authPendingUrl_ = uri;/);

  const closeWebView = section(
    webviewSource,
    'void StationheadPlayer::CloseWebView()',
    'void StationheadPlayer::CloseAuthWebView()',
  );
  const preserveAt = closeWebView.indexOf('const std::wstring& resumeUrl');
  const closeAuthAt = closeWebView.indexOf('CloseAuthWebView();');
  assert.ok(preserveAt >= 0 && preserveAt < closeAuthAt);
  assert.match(
    closeWebView,
    /activeAuthorizationUrl_\.empty\(\)[\s\S]*authPendingUrl_[\s\S]*activeAuthorizationUrl_[\s\S]*pendingAuthorizationUrl_ = resumeUrl;/,
  );
  assert.match(closeWebView, /status_\.loginRequired = false;/);
  assert.match(closeWebView, /status_\.spotifyAuthorization = false;/);
  assert.match(closeWebView, /status_\.processFailed = false;/);

  const closeAuthWebView = section(
    webviewSource,
    'void StationheadPlayer::CloseAuthWebView()',
    '}  // namespace hp',
  );
  assert.match(closeAuthWebView, /authPendingUrl_\.clear\(\);[\s\S]*activeAuthorizationUrl_\.clear\(\);/);
});

test('completed Spotify auth clears pending state even when controller creation failed', () => {
  assert.match(
    playerHeader,
    /void FinalizeCompletedAuth\(\) \{[\s\S]*!SpotifyAuthorizationActive\(\)[\s\S]*CloseAuthWebView\(\);/,
  );
  const releaseCompletedAuth = section(
    handleSource,
    'void StationheadHandleBase::ReleaseCompletedAuth()',
    'uint32_t StationheadHandleBase::ConsumeChangeFlags()',
  );
  assert.match(releaseCompletedAuth, /player_->FinalizeCompletedAuth\(\);/);
  assert.doesNotMatch(releaseCompletedAuth, /player_->ReleaseCompletedAuth\(\);/);
});

test('auth release is consumed per player before A/B change flags are merged', () => {
  const consumeFlags = section(
    handleSource,
    'uint32_t StationheadHandleBase::ConsumeChangeFlags()',
    'void StationheadHandleBase::AssignPlayer(',
  );
  assert.match(consumeFlags, /if \(\(flags & StationheadChangeReleaseAuth\) != 0\)/);
  assert.match(consumeFlags, /player_->FinalizeCompletedAuth\(\);/);
  assert.match(
    consumeFlags,
    /flags &= ~\(StationheadChangeReleaseAuth \| StationheadChangeReturnMain\);/,
  );
});

test('required playback WebView event registrations fail closed into recreation', () => {
  for (const resultName of ['newWindowResult', 'webMessageResult', 'processFailedResult']) {
    assert.match(webviewSource, new RegExp(`const HRESULT ${resultName} =`));
    assert.match(
      webviewSource,
      new RegExp(`if \\(FAILED\\(${resultName}\\)\\) \\{[\\s\\S]*ScheduleRecreate\\(`),
    );
  }
});

test('native logger redacts URL query and fragment data before writing diagnostics', () => {
  assert.match(loggerSource, /std::wstring RedactUrlQueryAndFragment\(const std::wstring& message\)/);
  assert.match(loggerSource, /sanitized\.find\(L"http:\/\/", searchAt\)/);
  assert.match(loggerSource, /sanitized\.find\(L"https:\/\/", searchAt\)/);
  assert.match(loggerSource, /sanitized\.find_first_of\(L"\?#", urlAt\)/);
  assert.match(loggerSource, /sanitized\.replace\(sensitiveAt, urlEnd - sensitiveAt, marker\)/);
  assert.match(loggerSource, /WideToUtf8\(RedactUrlQueryAndFragment\(message\)\)/);
});
