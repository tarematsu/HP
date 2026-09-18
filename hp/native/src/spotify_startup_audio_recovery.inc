namespace hp {
namespace {
constexpr unsigned kSpotifyNativeAudioStartCheckLimit = 2;
constexpr ULONGLONG kSpotifyFailedOnlyTrackRetryMs = 60ULL * 1000ULL;
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

  // When a first negative sample scheduled a second sample, do not let an
  // observer callback collapse the two checks into the same instant.
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

  // Lack of the optional interface is not playback-failure evidence. Preserve
  // compatibility and fall back to the DOM/media observer confirmation path.
  if (FAILED(interfaceResult) || !audioView || FAILED(stateResult)) {
    slot.nativeAudioStartVerified = true;
    slot.nativeAudioStartChecks = 0;
    slot.nextRecoveryTick = 0;
    return true;
  }

  ++slot.nativeAudioStartChecks;
  if (nativePlaying != FALSE) {
    slot.nativeAudioStartVerified = true;
    slot.nativeAudioStartChecks = 0;
    slot.nextRecoveryTick = 0;
    return true;
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
