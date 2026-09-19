#include <audiopolicy.h>
#include <endpointvolume.h>
#include <mmdeviceapi.h>

namespace hp {
namespace {
constexpr unsigned kSpotifyNativeAudioStartCheckLimit = 4;
constexpr ULONGLONG kSpotifyFailedOnlyTrackRetryMs = 60ULL * 1000ULL;
constexpr float kSpotifyAudiblePeakFloor = 0.000001f;

struct SpotifyProcessEntry {
  DWORD processId = 0;
  DWORD parentProcessId = 0;
  bool isWebView2 = false;
};

struct SpotifyWindowsAudioEvidence {
  bool querySucceeded = false;
  bool activeWebViewSession = false;
  bool audibleWebViewSession = false;
  float peak = 0.0f;
};

bool SpotifyPidListContains(
    const std::vector<DWORD>& processIds, DWORD processId) noexcept {
  return std::find(processIds.begin(), processIds.end(), processId) !=
      processIds.end();
}

std::vector<DWORD> SpotifyWebView2DescendantProcessIds() noexcept {
  std::vector<DWORD> result;
  std::vector<SpotifyProcessEntry> entries;
  HANDLE snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
  if (snapshot == INVALID_HANDLE_VALUE) return result;

  PROCESSENTRY32W entry{};
  entry.dwSize = sizeof(entry);
  if (Process32FirstW(snapshot, &entry)) {
    do {
      SpotifyProcessEntry captured{};
      captured.processId = entry.th32ProcessID;
      captured.parentProcessId = entry.th32ParentProcessID;
      captured.isWebView2 =
          _wcsicmp(entry.szExeFile, L"msedgewebview2.exe") == 0;
      entries.push_back(captured);
      entry.dwSize = sizeof(entry);
    } while (Process32NextW(snapshot, &entry));
  }
  CloseHandle(snapshot);

  std::vector<DWORD> ancestry{GetCurrentProcessId()};
  bool changed = true;
  while (changed) {
    changed = false;
    for (const SpotifyProcessEntry& candidate : entries) {
      if (!candidate.isWebView2 || candidate.processId == 0 ||
          SpotifyPidListContains(ancestry, candidate.processId) ||
          !SpotifyPidListContains(ancestry, candidate.parentProcessId)) {
        continue;
      }
      ancestry.push_back(candidate.processId);
      result.push_back(candidate.processId);
      changed = true;
    }
  }
  return result;
}

void MergeSpotifyWindowsAudioEvidenceForRole(
    IMMDeviceEnumerator* deviceEnumerator, ERole role,
    const std::vector<DWORD>& webViewProcessIds,
    SpotifyWindowsAudioEvidence* evidence) noexcept {
  if (!deviceEnumerator || !evidence || webViewProcessIds.empty()) return;

  ComPtr<IMMDevice> endpoint;
  if (FAILED(deviceEnumerator->GetDefaultAudioEndpoint(
          eRender, role, endpoint.GetAddressOf())) ||
      !endpoint) {
    return;
  }

  ComPtr<IAudioSessionManager2> sessionManager;
  if (FAILED(endpoint->Activate(
          __uuidof(IAudioSessionManager2), CLSCTX_ALL, nullptr,
          reinterpret_cast<void**>(sessionManager.GetAddressOf()))) ||
      !sessionManager) {
    return;
  }

  ComPtr<IAudioSessionEnumerator> sessions;
  if (FAILED(sessionManager->GetSessionEnumerator(sessions.GetAddressOf())) ||
      !sessions) {
    return;
  }
  evidence->querySucceeded = true;

  int sessionCount = 0;
  if (FAILED(sessions->GetCount(&sessionCount))) return;
  for (int index = 0; index < sessionCount; ++index) {
    ComPtr<IAudioSessionControl> control;
    if (FAILED(sessions->GetSession(index, control.GetAddressOf())) ||
        !control) {
      continue;
    }

    ComPtr<IAudioSessionControl2> control2;
    if (FAILED(control.As(&control2)) || !control2) continue;
    DWORD processId = 0;
    if (FAILED(control2->GetProcessId(&processId)) ||
        !SpotifyPidListContains(webViewProcessIds, processId)) {
      continue;
    }

    AudioSessionState state = AudioSessionStateInactive;
    if (FAILED(control->GetState(&state)) || state != AudioSessionStateActive) {
      continue;
    }
    evidence->activeWebViewSession = true;

    ComPtr<IAudioMeterInformation> meter;
    if (FAILED(control.As(&meter)) || !meter) continue;
    float peak = 0.0f;
    if (FAILED(meter->GetPeakValue(&peak))) continue;
    evidence->peak = std::max(evidence->peak, peak);
    if (peak > kSpotifyAudiblePeakFloor) {
      evidence->audibleWebViewSession = true;
    }
  }
}

SpotifyWindowsAudioEvidence ProbeSpotifyWindowsAudioEvidence() noexcept {
  SpotifyWindowsAudioEvidence evidence{};
  const std::vector<DWORD> webViewProcessIds =
      SpotifyWebView2DescendantProcessIds();
  if (webViewProcessIds.empty()) return evidence;

  ComPtr<IMMDeviceEnumerator> deviceEnumerator;
  if (FAILED(CoCreateInstance(
          __uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL,
          IID_PPV_ARGS(&deviceEnumerator))) ||
      !deviceEnumerator) {
    return evidence;
  }

  // Chromium media normally follows the multimedia endpoint. Also inspect the
  // console endpoint because Windows can assign different defaults per role.
  MergeSpotifyWindowsAudioEvidenceForRole(
      deviceEnumerator.Get(), eMultimedia, webViewProcessIds, &evidence);
  MergeSpotifyWindowsAudioEvidenceForRole(
      deviceEnumerator.Get(), eConsole, webViewProcessIds, &evidence);
  return evidence;
}

void RequestSpotifyAudioPipelineRestart(ICoreWebView2* webview) noexcept {
  if (!webview) return;
  static constexpr wchar_t kRestartScript[] = LR"JS(
(() => {
  const target = window.__homePanelSpotifyNativeTarget;
  const targetPath = target &&
      (target.path || target.trackPath || target.pagePath || '');
  if (!targetPath || location.hostname !== 'open.spotify.com') return false;
  const onTarget = location.pathname === targetPath ||
      (targetPath.startsWith('/track/') && location.pathname.endsWith(targetPath));
  if (!onTarget) return false;
  const normalize = value =>
      String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const pause = button => {
    if (!button || button.disabled ||
        button.getAttribute('aria-disabled') === 'true') return false;
    const label = normalize(
        button.getAttribute('aria-label') || button.getAttribute('title'));
    if (!label.includes('pause') && !label.includes('一時停止')) return false;
    try { button.click(); return true; } catch (_) { return false; }
  };
  const pagePause = Array.from(
      document.querySelectorAll('button[data-testid="play-button"]')).find(pause);
  if (pagePause) return true;
  const metadata = navigator.mediaSession && navigator.mediaSession.metadata;
  if (normalize(metadata && metadata.title) !== normalize(target.title)) return false;
  const globalPause = Array.from(
      document.querySelectorAll('button[data-testid="control-button-playpause"]')).find(pause);
  return !!globalPause;
})()
)JS";

  webview->ExecuteScript(
      kRestartScript,
      Callback<ICoreWebView2ExecuteScriptCompletedHandler>(
          [](HRESULT, LPCWSTR) -> HRESULT { return S_OK; }).Get());
}
}  // namespace

void SpotifyWebViews::SkipFailedSpotifyTrack(Slot& slot) noexcept {
  const ULONGLONG now = GetTickCount64();
  std::wstring failedPath;
  if (const ManagedTrack* track = CurrentMusicTrack(slot)) {
    failedPath = track->path;
  }

  slot.timedCompletionDeadlineTick = 0;
  slot.timedCompletionDeadlineGeneration = 0;
  slot.playbackConfirmed = false;
  slot.nativeAudioStartChecks = 0;
  slot.nativeAudioStartVerified = false;
  slot.trustedClickBlockedUntilTick = 0;
  AdvanceTimedRotationSlot(slot);

  const ManagedTrack* nextTrack = CurrentMusicTrack(slot);
  if (!nextTrack) {
    ArmRobustScheduler();
    return;
  }

  // A fixed one-track group has no distinct target to skip to. Avoid an
  // immediate hot loop; retry that sole target only after a bounded cooldown.
  if (!failedPath.empty() && nextTrack->path == failedPath) {
    SetSlotState(slot, SlotState::WaitingTarget);
    slot.nextRecoveryTick = now + kSpotifyFailedOnlyTrackRetryMs;
    ArmRobustScheduler();
    return;
  }

  NavigateMusicTarget(slot);
}

bool SpotifyWebViews::EscalateSpotifyStartupFailure(
    Slot& slot, ULONGLONG now, bool requestRebuild) noexcept {
  const SpotifyTrackStartRecoveryAction action =
      NextSpotifyTrackStartRecoveryAction(
          slot.trackStartRecovery, slot.targetGeneration,
          requestRebuild, now);

  if (action == SpotifyTrackStartRecoveryAction::ReloadDocument) {
    slot.nativeAudioStartChecks = 0;
    slot.nativeAudioStartVerified = false;
    slot.playbackConfirmed = false;
    slot.trustedClickBlockedUntilTick = 0;
    slot.timedCompletionDeadlineTick = 0;
    slot.timedCompletionDeadlineGeneration = 0;
    SetSlotState(slot, SlotState::Navigating);
    slot.nextRecoveryTick = now + kSpotifyRecoveryRetryMs;
    if (!slot.webview || FAILED(slot.webview->Reload())) {
      MarkSlotRecovering(slot, now);
    }
    RecomputeForeground();
    ArmRobustScheduler();
    return true;
  }

  if (action == SpotifyTrackStartRecoveryAction::RebuildSurface) {
    slot.nativeAudioStartChecks = 0;
    slot.nativeAudioStartVerified = false;
    slot.playbackConfirmed = false;
    slot.mediaPipelineRecoveryGeneration = slot.targetGeneration;
    slot.mediaPipelineRecoveryPending = true;
    slot.timedCompletionDeadlineTick = 0;
    slot.timedCompletionDeadlineGeneration = 0;
    SetSlotState(slot, SlotState::Recovering);
    slot.nextRecoveryTick = now;
    ArmRobustScheduler();
    return true;
  }

  if (action == SpotifyTrackStartRecoveryAction::SkipTrack) {
    SkipFailedSpotifyTrack(slot);
    return true;
  }

  return false;
}

bool SpotifyWebViews::ConfirmSpotifyNativeAudioStart(
    Slot& slot, ULONGLONG now) noexcept {
  if (slot.nativeAudioStartVerified) return true;
  if (!slot.webview || !CurrentMusicTrack(slot)) return false;

  // Keep successive negative samples on the configured two-second cadence.
  // The second failed sample first forces the current Pause control back to
  // Play, so the existing trusted CDP click path gets one clean restart before
  // the bounded Reload -> Rebuild -> Skip ladder begins.
  if (slot.nativeAudioStartChecks != 0 && slot.nextRecoveryTick != 0 &&
      now < slot.nextRecoveryTick) {
    return false;
  }

  ComPtr<ICoreWebView2_8> audioView;
  BOOL nativePlaying = FALSE;
  const HRESULT interfaceResult = slot.webview.As(&audioView);
  const HRESULT stateResult =
      SUCCEEDED(interfaceResult) && audioView
          ? audioView->get_IsDocumentPlayingAudio(&nativePlaying)
          : E_NOINTERFACE;

  ++slot.nativeAudioStartChecks;

  bool startupAudioVerified = false;
  if (SUCCEEDED(interfaceResult) && audioView && SUCCEEDED(stateResult) &&
      nativePlaying != FALSE) {
    const SpotifyWindowsAudioEvidence windowsAudio =
        ProbeSpotifyWindowsAudioEvidence();
    const int runtimeLane = SpotifyRuntimeLaneForAccount(slot.index);
    const bool requiresPhysicalPeak =
        runtimeLane >= 0 && runtimeLane == gSpotifyAudioOutputSlot;

    // Every lane must still be attached to an active WebView2 Core Audio
    // session. The one lane intentionally routed to speakers additionally has
    // to produce a real PCM peak. Muted background lanes cannot require a peak,
    // because WebView2 muting intentionally zeros their physical output.
    startupAudioVerified =
        windowsAudio.querySucceeded && windowsAudio.activeWebViewSession &&
        (!requiresPhysicalPeak || windowsAudio.audibleWebViewSession);
  }

  if (startupAudioVerified) {
    slot.nativeAudioStartVerified = true;
    slot.nativeAudioStartChecks = 0;
    slot.nextRecoveryTick = 0;
    return true;
  }

  // "Could not query" is deliberately not success. After two failed samples,
  // pause the verified target once; the normal reconcile pass will then issue
  // a fresh trusted Play click. This catches the common state where Spotify's
  // DOM/media clock says Playing while the native audio path never came up.
  if (slot.nativeAudioStartChecks == 2) {
    RequestSpotifyAudioPipelineRestart(slot.webview.Get());
    slot.trustedClickBlockedUntilTick = 0;
  }

  if (slot.nativeAudioStartChecks < kSpotifyNativeAudioStartCheckLimit) {
    SetSlotState(slot, SlotState::WaitingTarget);
    slot.nextRecoveryTick = now + kSpotifyNativeAudioStartRetryMs;
    ArmRobustScheduler();
    return false;
  }

  slot.nativeAudioStartChecks = 0;
  const bool requestRebuild = slot.trackStartRecovery.reloadIssued;
  EscalateSpotifyStartupFailure(slot, now, requestRebuild);
  return false;
}

}  // namespace hp
