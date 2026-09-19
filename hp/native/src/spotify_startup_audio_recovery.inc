namespace hp {
namespace {
constexpr unsigned kSpotifyNativeAudioStartCheckLimit = 4;
constexpr ULONGLONG kSpotifyFailedOnlyTrackRetryMs = 60ULL * 1000ULL;

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

  // The caller reaches this method only after target identity and actual
  // HTMLMediaElement clock progress have been confirmed. Add two independent,
  // slot-local native signals here: WebView2 must report document audio and the
  // same WebView's CDP Media domain must have observed a fresh playback event
  // for this target generation with both an audio decoder and audio tracks.
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

  const bool startupAudioVerified =
      SUCCEEDED(interfaceResult) && audioView && SUCCEEDED(stateResult) &&
      nativePlaying != FALSE &&
      SpotifyMediaStartEvidenceReady(slot.index, slot.targetGeneration);

  if (startupAudioVerified) {
    slot.nativeAudioStartVerified = true;
    slot.nativeAudioStartChecks = 0;
    slot.nextRecoveryTick = 0;
    return true;
  }

  // "Could not query" and missing CDP decoder/track/playback evidence are all
  // deliberately fail-closed. After two failed samples, pause the verified
  // target once; the normal reconcile pass then issues a fresh trusted Play
  // click before the bounded Reload -> Rebuild -> Skip ladder begins.
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
