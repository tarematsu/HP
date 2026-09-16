namespace hp {
namespace {

constexpr ULONGLONG kSpotifyNavigationFailsafeMs = 4ULL * 60ULL * 1000ULL;
constexpr ULONGLONG kSpotifyNavigationCompletionGraceMs = 2ULL * 1000ULL;
constexpr ULONGLONG kSpotifyTrackTransitionRetryMs = 500ULL;
constexpr ULONGLONG kSpotifyPlaybackStateProbeMs = 2ULL * 1000ULL;
constexpr ULONGLONG kSpotifyCdpPlayRetryFailsafeMs = 5ULL * 1000ULL;
constexpr ULONGLONG kSpotifyTrackTransitionRetryMaxMs = 2ULL * 1000ULL;

ULONGLONG ParseSpotifyRetryDelay(LPCWSTR json) noexcept {
  if (!json) return 0;
  try {
    const std::wstring value(json);
    if (value.empty() || value.front() < L'0' || value.front() > L'9') return 0;
    size_t consumed = 0;
    const unsigned long long parsed = std::stoull(value, &consumed, 10);
    if (consumed != value.size() || parsed < kSpotifyTrackTransitionRetryMs ||
        parsed > kSpotifyTrackTransitionRetryMaxMs) {
      return 0;
    }
    return static_cast<ULONGLONG>(parsed);
  } catch (...) {
    return 0;
  }
}

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

void SpotifyWebViews::SetMusicCompletionDeadline(
    Slot& slot, ULONGLONG playbackStartTick,
    ULONGLONG observedRemainingMs, bool replaceExisting) noexcept {
  const ManagedTrack* const track = CurrentMusicTrack(slot);
  if (playbackStartTick == 0 || !track) return;

  if (!replaceExisting && slot.timedCompletionDeadlineTick != 0 &&
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
  if (endedTick == 0 || !CurrentMusicTrack(slot)) return;

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

  const ULONGLONG now = GetTickCount64();
  SetSlotState(slot, SlotState::Navigating);
  slot.nextRecoveryTick = now + kSpotifyRecoveryRetryMs;
  SetSpotifyOutputMuted(slot.webview);
  PostSpotifyTargetDescriptorForSlot(slot);
  RecomputeForeground();

  ++slot.asyncEpoch;
  if (slot.asyncEpoch == 0) ++slot.asyncEpoch;
  const ULONGLONG asyncEpoch = slot.asyncEpoch;
  const ULONGLONG requestedGeneration = slot.targetGeneration;
  slot.asyncWork = AsyncWork::Reconcile;
  slot.asyncStartedTick = now;

  Slot* const target = &slot;
  ComPtr<ICoreWebView2> requestedView = slot.webview;
  const auto alive = alive_;
  const HRESULT routeStarted = requestedView->ExecuteScript(
      kSpotifySpaRouteScript,
      Callback<ICoreWebView2ExecuteScriptCompletedHandler>(
          [this, alive, target, requestedView, requestedGeneration,
           asyncEpoch](HRESULT result, LPCWSTR json) -> HRESULT {
            if (!alive->load(std::memory_order_acquire) ||
                target->asyncEpoch != asyncEpoch ||
                target->asyncWork != AsyncWork::Reconcile ||
                target->webview.Get() != requestedView.Get()) {
              return S_OK;
            }
            target->asyncWork = AsyncWork::None;
            target->asyncStartedTick = 0;
            if (!started_ || requestedGeneration != target->targetGeneration) {
              return S_OK;
            }

            const ULONGLONG callbackNow = GetTickCount64();
            if (SUCCEEDED(result) && json &&
                std::wstring_view(json) == L"true") {
              SetSlotState(*target, SlotState::WaitingTarget);
              target->nextRecoveryTick =
                  callbackNow + kSpotifyTrackTransitionRetryMs;
              ArmRobustScheduler();
              return S_OK;
            }

            const ManagedTrack* const currentTrack = CurrentMusicTrack(*target);
            if (!currentTrack || currentTrack->url.empty() ||
                FAILED(requestedView->Navigate(currentTrack->url.c_str()))) {
              MarkSlotRecovering(*target, callbackNow);
            }
            ArmRobustScheduler();
            return S_OK;
          }).Get());

  if (FAILED(routeStarted)) {
    if (slot.asyncEpoch == asyncEpoch && slot.asyncWork == AsyncWork::Reconcile) {
      slot.asyncWork = AsyncWork::None;
      slot.asyncStartedTick = 0;
    }
    const ManagedTrack* const currentTrack = CurrentMusicTrack(slot);
    if (!currentTrack || currentTrack->url.empty() ||
        FAILED(slot.webview->Navigate(currentTrack->url.c_str()))) {
      MarkSlotRecovering(slot, GetTickCount64());
    }
  }
  ArmRobustScheduler();
}

void SpotifyWebViews::ReconcileMusicTarget(Slot& slot) noexcept {
  if (!slot.hostWindow || !IsWindow(slot.hostWindow)) return;
  if (!slot.webview) {
    BeginControllerCreate(slot);
    return;
  }

  if (SlotIsLoginPage(slot) || !CurrentMusicTrack(slot)) return;

  if (!SlotMatchesMusicTarget(slot)) {
    NavigateMusicTarget(slot);
    return;
  }

  if (slot.asyncWork != AsyncWork::None) return;

  const ULONGLONG now = GetTickCount64();
  PostSpotifyTargetDescriptorForSlot(slot);
  ++slot.asyncEpoch;
  if (slot.asyncEpoch == 0) ++slot.asyncEpoch;
  const ULONGLONG asyncEpoch = slot.asyncEpoch;
  const ULONGLONG requestedGeneration = slot.targetGeneration;
  slot.asyncWork = AsyncWork::Reconcile;
  slot.asyncStartedTick = now;

  Slot* const target = &slot;
  ComPtr<ICoreWebView2> requestedView = slot.webview;
  const auto alive = alive_;
  const HRESULT started = requestedView->ExecuteScript(
      kSpotifyScopedTrackReconcileScript,
      Callback<ICoreWebView2ExecuteScriptCompletedHandler>(
          [this, alive, target, requestedView, requestedGeneration,
           asyncEpoch](HRESULT result, LPCWSTR json) -> HRESULT {
            if (!alive->load(std::memory_order_acquire) ||
                target->asyncEpoch != asyncEpoch ||
                target->asyncWork != AsyncWork::Reconcile ||
                target->webview.Get() != requestedView.Get()) {
              return S_OK;
            }
            target->asyncWork = AsyncWork::None;
            target->asyncStartedTick = 0;
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
              const ManagedTrack* const currentTrack = CurrentMusicTrack(*target);
              if (!currentTrack) return S_OK;

              target->observedTrackTitle = currentTrack->title;
              GetLocalTime(&target->playbackConfirmedAt);
              target->playbackConfirmed = true;
              target->trustedClickBlockedUntilTick = 0;
              target->nextRecoveryTick = 0;
              InvalidateSpotifyStatusForHost(target->hostWindow);
              SetSlotState(*target, SlotState::Playing);
              SetMusicCompletionDeadline(*target, callbackNow);
              RecomputeForeground();
              ArmRobustScheduler();
              return S_OK;
            }

            if (json && std::wstring_view(json) == L"\"restart\"") {
              target->trustedClickBlockedUntilTick = 0;
              SetSlotState(*target, SlotState::WaitingTarget);
              target->nextRecoveryTick =
                  callbackNow + kSpotifyTrackTransitionRetryMs;
              RecomputeForeground();
              ArmRobustScheduler();
              return S_OK;
            }

            const ULONGLONG retryDelayMs = ParseSpotifyRetryDelay(json);
            if (retryDelayMs != 0) {
              SetSlotState(*target, SlotState::WaitingTarget);
              target->nextRecoveryTick = callbackNow + retryDelayMs;
              RecomputeForeground();
              ArmRobustScheduler();
              return S_OK;
            }

            double cssX = 0.0;
            double cssY = 0.0;
            if (ParseCssPoint(json, &cssX, &cssY)) {
              ClickSlotCssPoint(*target, cssX, cssY);
              return S_OK;
            }

            // Unknown intermediate state: keep probing without treating delayed
            // EcoQoS renderer work as a hard playback failure.
            SetSlotState(*target, SlotState::WaitingTarget);
            target->nextRecoveryTick =
                callbackNow + kSpotifyPlaybackStateProbeMs;
            RecomputeForeground();
            ArmRobustScheduler();
            return S_OK;
          }).Get());

  if (FAILED(started)) {
    if (slot.asyncEpoch == asyncEpoch && slot.asyncWork == AsyncWork::Reconcile) {
      slot.asyncWork = AsyncWork::None;
      slot.asyncStartedTick = 0;
    }
    MarkSlotRecovering(slot, GetTickCount64());
    RecomputeForeground();
    ArmRobustScheduler();
  }
}

}  // namespace hp
