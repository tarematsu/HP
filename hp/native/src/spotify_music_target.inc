namespace hp {
namespace {

constexpr ULONGLONG kSpotifyNavigationFailsafeMs = 4ULL * 60ULL * 1000ULL;
constexpr ULONGLONG kSpotifyNavigationCompletionGraceMs = 2ULL * 1000ULL;

}  // namespace

const SpotifyWebViews::ManagedTrack* SpotifyWebViews::CurrentMusicTrack(
    const Slot& slot) const noexcept {
  if (!slot.timedRotationActive ||
      slot.timedRotationPosition >= slot.timedCycleTracks.size()) {
    return nullptr;
  }
  return &slot.timedCycleTracks[slot.timedRotationPosition];
}

bool SpotifyWebViews::SlotMatchesMusicTarget(const Slot& slot) const noexcept {
  if (!slot.webview) return false;
  const ManagedTrack* const track = CurrentMusicTrack(slot);
  if (!track || track->path.empty()) return false;

  LPWSTR rawSource = nullptr;
  if (FAILED(slot.webview->get_Source(&rawSource)) || !rawSource) return false;
  const std::wstring source(rawSource);
  CoTaskMemFree(rawSource);
  return IsSpotifyOpenSource(source) && source.find(track->path) != std::wstring::npos;
}

void SpotifyWebViews::ArmMusicCompletionDeadlineFromStart(
    Slot& slot, ULONGLONG playbackStartTick,
    ULONGLONG observedRemainingMs) noexcept {
  const ManagedTrack* const track = CurrentMusicTrack(slot);
  if (playbackStartTick == 0 || !track) return;

  // One deadline per target generation. Later observer start events may confirm
  // playback but never postpone the deadline already anchored to trusted input.
  if (slot.timedCompletionDeadlineTick != 0 &&
      slot.timedCompletionDeadlineGeneration == slot.targetGeneration) {
    return;
  }

  ULONGLONG durationMs = observedRemainingMs;
  if (durationMs == 0) durationMs = track->durationMs;

  ULONGLONG completionDelayMs = kSpotifyNavigationFailsafeMs;
  if (durationMs > 0) {
    const ULONGLONG maxDurationMs =
        kSpotifyNavigationFailsafeMs - kSpotifyNavigationCompletionGraceMs;
    completionDelayMs =
        std::min(durationMs, maxDurationMs) +
        kSpotifyNavigationCompletionGraceMs;
  }

  slot.timedCompletionDeadlineTick = playbackStartTick + completionDelayMs;
  slot.timedCompletionDeadlineGeneration = slot.targetGeneration;
  ArmRobustScheduler();
}

void SpotifyWebViews::ShortenMusicCompletionDeadlineAtEnd(
    Slot& slot, ULONGLONG endedTick) noexcept {
  if (endedTick == 0 || !CurrentMusicTrack(slot) ||
      slot.timedInterruptionStartTick != 0) {
    return;
  }

  if (slot.timedCompletionDeadlineTick == 0 ||
      slot.timedCompletionDeadlineGeneration != slot.targetGeneration ||
      slot.timedCompletionDeadlineTick > endedTick) {
    slot.timedCompletionDeadlineTick = endedTick;
    slot.timedCompletionDeadlineGeneration = slot.targetGeneration;
    ArmRobustScheduler();
  }
}

void SpotifyWebViews::NavigateMusicTarget(Slot& slot) noexcept {
  if (!slot.webview) return;
  const ManagedTrack* const track = CurrentMusicTrack(slot);
  if (!track || track->url.empty()) return;

  slot.lastModeNavigateTick = GetTickCount64();
  SetSlotState(slot, SlotState::Navigating);
  SetSpotifyOutputMuted(slot.webview);
  PostSpotifyTargetDescriptorForSlot(slot);
  RecomputeForeground();

  const HRESULT result = slot.webview->Navigate(track->url.c_str());
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

  if (SlotIsLoginPage(slot) || !CurrentMusicTrack(slot)) return;

  if (!slot.timedObserverReady) {
    ArmTimedEndObserver(slot);
    ArmRobustScheduler();
    return;
  }

  const ULONGLONG now = GetTickCount64();
  if (!SlotMatchesMusicTarget(slot)) {
    MarkSlotRecovering(slot, now);
    if (slot.lastModeNavigateTick == 0 ||
        now - slot.lastModeNavigateTick >= kSpotifyRobustNavigateRetryMs) {
      NavigateMusicTarget(slot);
    }
    return;
  }

  // Navigation is scheduler-owned. Once a target has been unhealthy long enough,
  // re-navigation starts here before another DOM reconcile is launched.
  if (ShouldRenavigateUnhealthySlot(slot, now)) {
    MarkSlotRecovering(slot, now);
    NavigateMusicTarget(slot);
    return;
  }

  slot.lastModeNavigateTick = 0;
  if (slot.reconcileInFlight) return;

  PostSpotifyTargetDescriptorForSlot(slot);
  ++slot.reconcileRequestGeneration;
  if (slot.reconcileRequestGeneration == 0) ++slot.reconcileRequestGeneration;
  const ULONGLONG reconcileRequestGeneration = slot.reconcileRequestGeneration;
  slot.reconcileInFlight = true;
  slot.reconcileStartedTick = now;
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
                !CurrentMusicTrack(*target)) {
              return S_OK;
            }

            const ULONGLONG callbackNow = GetTickCount64();
            if (FAILED(result)) {
              MarkSlotRecovering(*target, callbackNow);
              RecomputeForeground();
              ArmRobustScheduler();
              return S_OK;
            }

            if (json && std::wstring_view(json) == L"true") {
              if (target->state != SlotState::Playing) {
                SetSlotState(*target, SlotState::WaitingTarget);
              }
              RecomputeForeground();
              ArmRobustScheduler();
              return S_OK;
            }

            if (json && std::wstring_view(json) == L"\"wrong\"") {
              MarkSlotRecovering(*target, callbackNow);
              target->lastModeNavigateTick = 0;
              RecomputeForeground();
              ArmRobustScheduler();
              return S_OK;
            }

            if (json && (std::wstring_view(json) == L"\"starting\"" ||
                         std::wstring_view(json) == L"\"settling\"")) {
              SetSlotState(*target, SlotState::WaitingTarget);
              if (target->unhealthySinceTick == 0) {
                target->unhealthySinceTick = callbackNow;
              }
              RecomputeForeground();
              ArmRobustScheduler();
              return S_OK;
            }

            int x = 0;
            int y = 0;
            if (ParseNormalizedPoint(json, &x, &y)) {
              if (target->unhealthySinceTick == 0) {
                target->unhealthySinceTick = callbackNow;
              }
              ClickSlotNormalizedPoint(*target, x, y);
              ArmRobustScheduler();
              return S_OK;
            }

            MarkSlotRecovering(*target, callbackNow);
            RecomputeForeground();
            ArmRobustScheduler();
            return S_OK;
          }).Get());

  if (FAILED(started)) {
    if (slot.reconcileRequestGeneration == reconcileRequestGeneration &&
        slot.webview.Get() == requestedView.Get()) {
      slot.reconcileInFlight = false;
      slot.reconcileStartedTick = 0;
    }
    MarkSlotRecovering(slot, GetTickCount64());
    RecomputeForeground();
    ArmRobustScheduler();
  }
}

}  // namespace hp
