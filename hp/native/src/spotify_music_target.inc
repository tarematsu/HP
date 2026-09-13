namespace hp {
namespace {

constexpr ULONGLONG kSpotifyNavigationFailsafeMs = 5ULL * 60ULL * 1000ULL;
constexpr ULONGLONG kSpotifyNavigationCompletionGraceMs = 2ULL * 1000ULL;

}  // namespace

SpotifyWebViews::MusicTargetDescriptor SpotifyWebViews::ResolveMusicTarget(
    const Slot& slot) const noexcept {
  if (slot.timedTarget != TimedSpotifyTarget::Music ||
      slot.timedRotationPosition >= slot.timedCycleTracks.size()) {
    return {};
  }
  const ManagedTrack& track = slot.timedCycleTracks[slot.timedRotationPosition];
  return {track.title.c_str(), track.url.c_str(), track.path.c_str()};
}

bool SpotifyWebViews::SlotMatchesMusicTarget(const Slot& slot) const noexcept {
  if (!slot.webview) return false;
  const MusicTargetDescriptor target = ResolveMusicTarget(slot);
  if (!target.path) return false;

  LPWSTR rawSource = nullptr;
  if (FAILED(slot.webview->get_Source(&rawSource)) || !rawSource) return false;
  const std::wstring source(rawSource);
  CoTaskMemFree(rawSource);
  return IsSpotifyOpenSource(source) && source.find(target.path) != std::wstring::npos;
}

void SpotifyWebViews::ArmMusicCompletionDeadlineFromStart(
    Slot& slot, ULONGLONG playbackStartTick,
    ULONGLONG observedRemainingMs) noexcept {
  if (playbackStartTick == 0 || !slot.timedRotationActive ||
      slot.timedTarget != TimedSpotifyTarget::Music) {
    return;
  }
  if (slot.timedCompletionDeadlineTick != 0 &&
      slot.timedCompletionDeadlineGeneration == slot.targetGeneration) {
    if (slot.timedPlaybackStartTick == 0) {
      slot.timedPlaybackStartTick = playbackStartTick;
    }
    return;
  }

  ULONGLONG durationMs = observedRemainingMs;
  if (durationMs == 0 &&
      slot.timedRotationPosition < slot.timedCycleTracks.size()) {
    durationMs = slot.timedCycleTracks[slot.timedRotationPosition].durationMs;
  }

  ULONGLONG completionDelayMs = kSpotifyNavigationFailsafeMs;
  if (durationMs > 0) {
    const ULONGLONG maxDurationMs =
        kSpotifyNavigationFailsafeMs - kSpotifyNavigationCompletionGraceMs;
    completionDelayMs =
        std::min(durationMs, maxDurationMs) +
        kSpotifyNavigationCompletionGraceMs;
  }

  // The play-button press is the native start anchor. Navigation/loading time is
  // deliberately excluded. Observer-reported remaining time uses this same
  // path for direct-play fallback, and PR #897 ad interruptions subsequently
  // extend this same generation-scoped deadline by their measured duration.
  slot.timedPlaybackStartTick = playbackStartTick;
  slot.timedCompletionDeadlineTick = playbackStartTick + completionDelayMs;
  slot.timedCompletionDeadlineGeneration = slot.targetGeneration;
  ArmCompletionDeadlineTimer();
}

void SpotifyWebViews::ShortenMusicCompletionDeadlineAtEnd(
    Slot& slot, ULONGLONG endedTick) noexcept {
  if (endedTick == 0 || !slot.timedRotationActive ||
      slot.timedTarget != TimedSpotifyTarget::Music ||
      slot.timedInterruptionStartTick != 0) {
    return;
  }

  // Best-effort ended detection never creates a second timer. It only moves the
  // generation's existing unified deadline earlier; the normal deadline probe
  // remains the sole transition path to the next target.
  if (slot.timedCompletionDeadlineTick == 0 ||
      slot.timedCompletionDeadlineGeneration != slot.targetGeneration ||
      slot.timedCompletionDeadlineTick > endedTick) {
    slot.timedCompletionDeadlineTick = endedTick;
    slot.timedCompletionDeadlineGeneration = slot.targetGeneration;
    ArmCompletionDeadlineTimer();
  }
}

void SpotifyWebViews::NavigateMusicTarget(Slot& slot) noexcept {
  if (!slot.webview) return;
  const MusicTargetDescriptor target = ResolveMusicTarget(slot);
  if (!target.url) return;

  slot.lastModeNavigateTick = GetTickCount64();
  SetSlotState(slot, SlotState::Navigating);
  SetSpotifyOutputMuted(slot.webview);
  PostSpotifyTargetDescriptorForSlot(slot);
  RecomputeForeground();

  // Navigation only selects the requested target. Completion timing starts at
  // the subsequent trusted Play press, not while Spotify is still loading the
  // page. Recovery re-navigation for the same generation therefore cannot move
  // the song's start time or completion deadline.
  const HRESULT result = slot.webview->Navigate(target.url);
  if (FAILED(result)) {
    slot.lastModeNavigateTick = 0;
    MarkSlotRecovering(slot, GetTickCount64());
  }
  ArmRobustScheduler();
}

void SpotifyWebViews::ReconcileMusicTarget(Slot& slot) noexcept {
  if (!slot.hostWindow || !IsWindow(slot.hostWindow)) return;
  if (!slot.webview) {
    BeginControllerCreate(slot);
    return;
  }
  slot.controllerCreating = false;
  slot.controllerCreateTick = 0;

  if (SlotIsLoginPage(slot) || !ResolveMusicTarget(slot).url) return;

  // The media observer owns generation-tagged start/completion truth. Never
  // start a target before that observer has been installed for this document;
  // otherwise Spotify can begin playback while the observer still has the
  // default generation 0, causing native to reject the only start/deadline
  // events and leaving the slot able to repeat A or stop at currentTime=0.
  if (!slot.timedObserverReady) {
    ArmTimedEndObserver(slot);
    ArmRobustScheduler();
    return;
  }

  if (!SlotMatchesMusicTarget(slot)) {
    const ULONGLONG now = GetTickCount64();
    MarkSlotRecovering(slot, now);
    if (slot.lastModeNavigateTick == 0 ||
        now - slot.lastModeNavigateTick >= kSpotifyRobustNavigateRetryMs) {
      NavigateMusicTarget(slot);
    }
    return;
  }

  slot.lastModeNavigateTick = 0;
  if (slot.reconcileInFlight) return;

  PostSpotifyTargetDescriptorForSlot(slot);
  ++slot.reconcileRequestGeneration;
  if (slot.reconcileRequestGeneration == 0) ++slot.reconcileRequestGeneration;
  const ULONGLONG reconcileRequestGeneration = slot.reconcileRequestGeneration;
  slot.reconcileInFlight = true;
  slot.reconcileStartedTick = GetTickCount64();
  const ULONGLONG requestedGeneration = slot.targetGeneration;
  Slot* const target = &slot;
  ComPtr<ICoreWebView2> requestedView = slot.webview;
  const auto alive = alive_;
  const HRESULT started = requestedView->ExecuteScript(
      kSpotifyStaticTrackReconcileScript,
      Callback<ICoreWebView2ExecuteScriptCompletedHandler>(
          [this, alive, target, requestedView, requestedGeneration,
           reconcileRequestGeneration](HRESULT result, LPCWSTR json) -> HRESULT {
            if (!alive->load(std::memory_order_acquire)) return S_OK;
            if (target->reconcileRequestGeneration != reconcileRequestGeneration ||
                target->webview.Get() != requestedView.Get()) {
              return S_OK;
            }
            target->reconcileInFlight = false;
            target->reconcileStartedTick = 0;
            if (!started_ || requestedGeneration != target->targetGeneration ||
                !ResolveMusicTarget(*target).url) {
              return S_OK;
            }

            const ULONGLONG now = GetTickCount64();
            if (FAILED(result)) {
              MarkSlotRecovering(*target, now);
              if (ShouldRenavigateUnhealthySlot(*target, now)) {
                NavigateMusicTarget(*target);
              } else {
                RecomputeForeground();
                ArmRobustScheduler();
              }
              return S_OK;
            }

            if (json && std::wstring_view(json) == L"true") {
              // Only the generation-tagged media observer may promote music to
              // Playing. Reconcile can observe a healthy surface but does not
              // own playback truth.
              if (target->state != SlotState::Playing) {
                SetSlotState(*target, SlotState::WaitingTarget);
              }
              RecomputeForeground();
              ArmRobustScheduler();
              return S_OK;
            }

            if (json && std::wstring_view(json) == L"\"wrong\"") {
              // A different identifiable track is actively playing. Recovery is
              // target replacement by navigation, never a pause/toggle click.
              MarkSlotRecovering(*target, now);
              target->lastModeNavigateTick = 0;
              NavigateMusicTarget(*target);
              return S_OK;
            }

            if (json && (std::wstring_view(json) == L"\"starting\"" ||
                         std::wstring_view(json) == L"\"settling\"")) {
              // starting means the requested media element received play()
              // directly; settling means Spotify has not exposed a safe start
              // actuator yet. Neither state clicks an ambiguous Pause control.
              SetSlotState(*target, SlotState::WaitingTarget);
              if (target->unhealthySinceTick == 0) target->unhealthySinceTick = now;
              if (ShouldRenavigateUnhealthySlot(*target, now)) {
                NavigateMusicTarget(*target);
              } else {
                RecomputeForeground();
                ArmRobustScheduler();
              }
              return S_OK;
            }

            int x = 0;
            int y = 0;
            if (ParseNormalizedPoint(json, &x, &y)) {
              // The JS side returns coordinates only for an explicitly
              // Play-labelled target control. Pause-labelled controls never
              // enter this trusted-click path.
              if (target->unhealthySinceTick == 0) target->unhealthySinceTick = now;
              if (ShouldRenavigateUnhealthySlot(*target, now)) {
                NavigateMusicTarget(*target);
              } else {
                ClickSlotNormalizedPoint(*target, x, y);
                ArmRobustScheduler();
              }
              return S_OK;
            }

            MarkSlotRecovering(*target, now);
            if (ShouldRenavigateUnhealthySlot(*target, now)) {
              NavigateMusicTarget(*target);
            } else {
              RecomputeForeground();
              ArmRobustScheduler();
            }
            return S_OK;
          }).Get());

  if (FAILED(started)) {
    if (slot.reconcileRequestGeneration == reconcileRequestGeneration &&
        slot.webview.Get() == requestedView.Get()) {
      slot.reconcileInFlight = false;
      slot.reconcileStartedTick = 0;
    }
    const ULONGLONG now = GetTickCount64();
    MarkSlotRecovering(slot, now);
    if (ShouldRenavigateUnhealthySlot(slot, now)) {
      NavigateMusicTarget(slot);
    } else {
      RecomputeForeground();
      ArmRobustScheduler();
    }
  }
}

}  // namespace hp
