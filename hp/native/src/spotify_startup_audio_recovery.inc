namespace hp {
namespace {
constexpr unsigned kSpotifyNativeAudioStartCheckLimit = 4;
constexpr ULONGLONG kSpotifyFailedOnlyTrackRetryMs = 60ULL * 1000ULL;
std::array<ULONGLONG, kSpotifyActiveAccountCount>
    gSpotifyNativeAudioFirstPassTicks{};
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
  if (slot.index < gSpotifyNativeAudioFirstPassTicks.size()) {
    gSpotifyNativeAudioFirstPassTicks[slot.index] = 0;
  }
  AdvanceTimedRotationSlot(slot);

  const ManagedTrack* nextTrack = CurrentMusicTrack(slot);
  if (!nextTrack) {
    ArmRobustScheduler();
    return;
  }

  // A fixed one-track group has nowhere else to advance. Avoid a hot loop and
  // give that target a fresh generation after a one-minute cooldown.
  if (!failedPath.empty() && nextTrack->path == failedPath) {
    SetSlotState(slot, SlotState::WaitingTarget);
    slot.nextRecoveryTick = now + kSpotifyFailedOnlyTrackRetryMs;
    ArmRobustScheduler();
    return;
  }

  NavigateMusicTarget(slot);
}

bool SpotifyWebViews::EscalateSpotifyStartupFailure(
    Slot& slot, ULONGLONG now) noexcept {
  if (slot.index < gSpotifyNativeAudioFirstPassTicks.size()) {
    gSpotifyNativeAudioFirstPassTicks[slot.index] = 0;
  }

  // Normal startup has exactly one destructive retry. The first failure reloads
  // the same target; a second failure skips it. WebView rebuild is intentionally
  // absent here and remains reserved for explicit process/DRM/media errors.
  if (ConsumeSpotifyStartupReload(
          slot.trackStartRecovery, slot.targetGeneration, now)) {
    slot.nativeAudioStartChecks = 0;
    slot.nativeAudioStartVerified = false;
    slot.playbackConfirmed = false;
    slot.trustedClickBlockedUntilTick = 0;
    slot.timedCompletionDeadlineTick = 0;
    slot.timedCompletionDeadlineGeneration = 0;
    RestartSpotifyMediaStartEvidenceWindow(slot.index, slot.targetGeneration);
    SetSlotState(slot, SlotState::Navigating);
    slot.nextRecoveryTick = now + kSpotifyRecoveryRetryMs;
    if (!slot.webview || FAILED(slot.webview->Reload())) {
      SkipFailedSpotifyTrack(slot);
      return true;
    }
    RecomputeForeground();
    ArmRobustScheduler();
    return true;
  }

  SkipFailedSpotifyTrack(slot);
  return true;
}

bool SpotifyWebViews::ConfirmSpotifyNativeAudioStart(
    Slot& slot, ULONGLONG now) noexcept {
  if (slot.nativeAudioStartVerified) return true;
  if (!slot.webview || !CurrentMusicTrack(slot) ||
      slot.index >= gSpotifyNativeAudioFirstPassTicks.size()) {
    return false;
  }

  ULONGLONG& firstPassTick = gSpotifyNativeAudioFirstPassTicks[slot.index];
  if (slot.nativeAudioStartChecks == 0) firstPassTick = 0;
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

  // Keep the useful false-positive protection: target/media progress must be
  // followed by two complete native-audio/CDP-positive samples two seconds
  // apart. No Pause/Play repair is attempted between samples.
  if (startupAudioVerified) {
    if (firstPassTick != 0 && now >= firstPassTick &&
        now - firstPassTick >= kSpotifyNativeAudioStartRetryMs) {
      firstPassTick = 0;
      slot.nativeAudioStartVerified = true;
      slot.nativeAudioStartChecks = 0;
      slot.nextRecoveryTick = 0;
      return true;
    }
    if (firstPassTick == 0) firstPassTick = now == 0 ? 1 : now;
  } else {
    firstPassTick = 0;
  }

  if (slot.nativeAudioStartChecks < kSpotifyNativeAudioStartCheckLimit) {
    SetSlotState(slot, SlotState::WaitingTarget);
    slot.nextRecoveryTick = now + kSpotifyNativeAudioStartRetryMs;
    ArmRobustScheduler();
    return false;
  }

  firstPassTick = 0;
  slot.nativeAudioStartChecks = 0;
  EscalateSpotifyStartupFailure(slot, now);
  return false;
}

}  // namespace hp
