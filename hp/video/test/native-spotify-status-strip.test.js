import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const header = readFileSync(
  new URL('../../native/src/spotify_webviews.h', import.meta.url), 'utf8');
const scripts = readFileSync(
  new URL('../../native/src/spotify_static_scripts.inc', import.meta.url), 'utf8');
const processTitle = readFileSync(
  new URL('../../native/src/spotify_process_title_status.inc', import.meta.url), 'utf8');
const controller = readFileSync(
  new URL('../../native/src/spotify_controller_lifecycle.inc', import.meta.url), 'utf8');
const stagger = readFileSync(
  new URL('../../native/src/spotify_stagger_schedule.inc', import.meta.url), 'utf8');
const runtime = readFileSync(
  new URL('../../native/src/spotify_media_observer_runtime.inc', import.meta.url), 'utf8');
const rotation = readFileSync(
  new URL('../../native/src/spotify_timed_end_rotation.inc', import.meta.url), 'utf8');
const reconcile = readFileSync(
  new URL('../../native/src/spotify_scoped_track_reconcile.inc', import.meta.url), 'utf8');
const musicTarget = readFileSync(
  new URL('../../native/src/spotify_music_target.inc', import.meta.url), 'utf8');
const phase = readFileSync(
  new URL('../../native/src/spotify_phase_sync.inc', import.meta.url), 'utf8');
const lifecycle = readFileSync(
  new URL('../../native/src/renderer_lifecycle.cpp', import.meta.url), 'utf8');
const hostWindow = readFileSync(
  new URL('../../native/src/renderer_panels/media_host_window.inc', import.meta.url), 'utf8');

test('yuukiar, ten, nagi and hinata Spotify slots are active with existing profile numbers', () => {
  assert.match(header, /kSpotifyProfileFirstAccountNumber = 2/);
  assert.match(header, /kSpotifyActiveAccountCount = 4/);
  assert.match(header, /kAccountCount = kSpotifyActiveAccountCount/);
  assert.match(scripts, /L"yuukiar"/);
  assert.match(scripts, /L"ten"/);
  assert.match(scripts, /L"nagi"/);
  assert.match(scripts, /L"hinata"/);
  assert.doesNotMatch(scripts, /L"amazon"|L"ozeki"/);
});

test('status track comes only from the Web Player now-playing surface', () => {
  assert.match(header, /std::wstring observedTrackTitle/);
  assert.match(header, /std::wstring processTrackDisplay/);
  assert.match(header, /SYSTEMTIME processTitleObservedAt/);
  assert.match(header, /void PollProcessTitleStatus\(ULONGLONG now\) noexcept/);
  assert.match(header, /void PollPlaybackStatusesNow\(\) noexcept/);
  assert.match(header, /void PollSpotifyPlaybackStatusesNow\(\) noexcept/);
  assert.doesNotMatch(header, /documentTitleChangedToken|processTitleEventRegistered|PollProcessTitleStatusFallback/);
  assert.doesNotMatch(
    controller,
    /add_DocumentTitleChanged|ICoreWebView2DocumentTitleChangedEventHandler/,
  );

  assert.match(processTitle, /kSpotifyNowPlayingDomScript/);
  assert.match(processTitle, /\[data-testid="now-playing-widget"\]/);
  assert.match(processTitle, /\[data-testid="now-playing-bar"\]/);
  assert.match(processTitle, /\[data-testid="main-view-player-bar"\]/);
  assert.match(processTitle, /\[data-testid="bottom-bar"\]/);
  assert.match(processTitle, /\[data-testid="context-item-info-title"\]/);
  assert.match(processTitle, /nowplaying-track-link/);
  assert.match(processTitle, /now-playing-widget-title/);
  assert.match(processTitle, /TrySpotifyNowPlayingTrackFromJson/);
  assert.match(processTitle, /ExecuteScript\(\s*kSpotifyNowPlayingDomScript/);

  // Each slot is read once per minute, phased 15 seconds apart. A single
  // scheduler pass may probe at most one slot, including after sleep/stalls.
  assert.match(processTitle, /kSpotifyProcessTitlePollMs = 60ULL \* 1000ULL/);
  assert.match(processTitle, /kSpotifyProcessTitlePollPhaseMs/);
  assert.match(processTitle, /kSpotifyProcessTitlePollPhaseMs == 15ULL \* 1000ULL/);
  assert.match(processTitle, /size_t selected = slots_\.size\(\)/);
  assert.match(processTitle, /break;/);
  assert.match(processTitle, /catchUpDelay = kSpotifyProcessTitlePollPhaseMs/);
  assert.match(processTitle, /slot\.nextProcessTitlePollTick = now \+ catchUpDelay/);
  assert.match(processTitle, /slot\.nextProcessTitlePollTick = now \+ kSpotifyProcessTitlePollMs/);
  assert.match(controller, /statusPhaseBase/);
  assert.match(controller, /static_cast<ULONGLONG>\(slot\.index\) \* kSpotifyProcessTitlePollPhaseMs/);

  // Status must never be synthesized from the next managed target or other
  // stale metadata/title surfaces.
  assert.doesNotMatch(processTitle, /__homePanelSpotifyNativeTarget/);
  assert.doesNotMatch(processTitle, /navigator\.mediaSession/);
  assert.doesNotMatch(processTitle, /document\.title/);
  assert.doesNotMatch(processTitle, /GetWindowTextW/);
  assert.doesNotMatch(processTitle, /EnumChildWindows|EnumWindows/);
  assert.doesNotMatch(processTitle, /GetProcessExtendedInfos/);
  assert.doesNotMatch(processTitle, /observedTrackTitle/);

  // A valid empty player reading clears stale UI instead of preserving a prior
  // track forever.
  assert.match(processTitle, /const bool observed = !display\.empty\(\)/);
  assert.match(processTitle, /target->processTrackDisplay = std::move\(display\)/);
  assert.match(processTitle, /target->processTitleObserved = observed/);
  assert.match(processTitle, /target->processTitleObservedAt = \{\}/);
  assert.match(processTitle, /InvalidateSpotifyStatusForHost\(target->hostWindow\)/);

  assert.doesNotMatch(
    controller,
    /slot\.nextProcessTitlePollTick = GetTickCount64\(\)/,
  );
  assert.doesNotMatch(
    controller,
    /RefreshProcessTitleStatus\(slot, slot\.webview\.Get\(\)\)/,
  );
  assert.match(stagger, /PollProcessTitleStatus\(now\)/);
  assert.match(phase, /if \(slot\.webview\) \{/);
  assert.match(phase, /considerTick\(slot\.nextProcessTitlePollTick/);
  assert.match(lifecycle, /SpotifyWebViews::PollPlaybackStatusesNow\(\) noexcept/);
  assert.match(lifecycle, /PollProcessTitleStatus\(GetTickCount64\(\)\)/);
  assert.match(lifecycle, /void PollSpotifyPlaybackStatusesNow\(\) noexcept/);

  assert.match(musicTarget, /target->observedTrackTitle = currentTrack->title/);
  assert.match(musicTarget, /GetLocalTime\(&target->playbackConfirmedAt\)/);
  assert.match(musicTarget, /target->playbackConfirmed = true/);
  assert.match(musicTarget, /SetMusicCompletionDeadline\(\*target, callbackNow\)/);
  assert.match(rotation, /target->observedTrackTitle = currentTrack->title/);
  assert.match(runtime, /postFields\('spotify:timed-started', String\(remainingMs\)\)/);
  assert.match(runtime, /postFields\('spotify:timed-resumed', String\(remainingMs\)\)/);
  assert.match(rotation, /slot\.observedTrackTitle\.clear\(\)/);
  assert.match(rotation, /slot\.playbackConfirmed = false/);
  assert.match(scripts, /result\[i\]\.trackTitle = slots_\[i\]\.processTrackDisplay/);
  assert.match(lifecycle, /GetSpotifyPlaybackStatuses\(\) noexcept/);
});

test('reconcile confirms verified Pause without observer acknowledgement or Monitor C visibility', () => {
  assert.match(reconcile, /button\[data-testid="play-button"\]/);
  assert.match(reconcile, /button\[data-testid="control-button-playpause"\]/);
  assert.match(reconcile, /const visiblePageButton = pageButtons\.find\(visible\)/);
  assert.match(reconcile, /pageButtons\.some\(isPauseControl\)/);
  assert.match(reconcile, /const playerPause = playerButtons\.find\(isPauseControl\)/);
  assert.match(reconcile, /playerPause && currentTrackMatchesTarget\(\)/);
  assert.match(reconcile, /return point\(visiblePageButton\)/);
  assert.doesNotMatch(reconcile, /point\(playerPause\)|querySelector\('audio'\)|audio\.play\(|direct-play|DirectPlay/);
  assert.doesNotMatch(reconcile, /mediaState|controlIntent|buttonIntent|settling/);
  assert.doesNotMatch(reconcile, /runtime\.scheduleTargetChecks/);
  assert.doesNotMatch(reconcile, /setInterval|SetTimer|CreateThreadpoolTimer/);

  const start = musicTarget.indexOf('if (json &&');
  const pointStart = musicTarget.indexOf('double cssX = 0.0;', start);
  assert.ok(start >= 0 && pointStart > start);
  const confirmation = musicTarget.slice(start, pointStart);
  assert.match(confirmation, /SetSlotState\(\*target, SlotState::Playing\)/);
  assert.match(confirmation, /SetMusicCompletionDeadline\(\*target, callbackNow\)/);
  assert.match(confirmation, /target->playbackConfirmed = true/);
  assert.doesNotMatch(confirmation, /ArmTimedEndObserver/);
});

test('Spotify status overlays the independent 16:9 media surface', () => {
  assert.match(hostWindow, /kNativeSpotifyStatusHeight = 56/);
  assert.match(hostWindow, /kNativeSpotifyStatusPollTimer = 0x5350/);
  assert.match(hostWindow, /kNativeSpotifyStatusPollMs = 60U \* 1000U/);
  assert.match(hostWindow, /case WM_TIMER:/);
  assert.match(hostWindow, /PollSpotifyPlaybackStatusesNow\(\)/);
  assert.match(hostWindow, /SetTimer\(status, kNativeSpotifyStatusPollTimer/);
  assert.match(hostWindow, /KillTimer\(hwnd, kNativeSpotifyStatusPollTimer\)/);
  assert.match(hostWindow, /GetSpotifyPlaybackStatuses\(\)/);
  assert.match(hostWindow, /const std::wstring& heading = statuses\[i\]\.windowName/);
  assert.match(hostWindow, /const std::wstring& track = statuses\[i\]\.trackTitle/);
  assert.doesNotMatch(hostWindow, /SpotifyStatusClock|確認|confirmedAt/);
  assert.match(hostWindow, /statuses\.size\(\)/);
  assert.match(hostWindow, /kSpotifyStatusSurface = RGB\(20, 26, 36\)/);
  assert.match(hostWindow, /kSpotifyStatusOutline = RGB\(43, 54, 69\)/);
  assert.match(hostWindow, /RoundRect\(paintDc, card\.left/);
  assert.match(hostWindow, /CreateCompatibleDC\(dc\)/);
  assert.match(hostWindow, /BitBlt\(dc, 0, 0, width, height, paintDc/);
  assert.match(hostWindow, /case WM_NCHITTEST:[\s\S]*return HTTRANSPARENT/);
  assert.match(hostWindow, /videoHeight = std::max<LONG>\(1, videoWidth \* 9 \/ 16\)/);
  assert.match(hostWindow, /videoWidth = std::max<LONG>\(1, videoHeight \* 16 \/ 9\)/);
  assert.match(hostWindow, /RECT statusBounds = videoBounds/);
  assert.doesNotMatch(hostWindow, /videoBounds\.top =[^;]*statusBounds\.bottom/);
  assert.match(hostWindow, /SetWindowPos\(status, HWND_TOP/);
  assert.match(phase, /InvalidateSpotifyStatusForHost/);
  assert.match(phase, /InvalidateRect\(status, nullptr, FALSE\)/);
});
