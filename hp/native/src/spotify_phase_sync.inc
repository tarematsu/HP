namespace hp {
namespace {

constexpr UINT kSpotifySchedulerBootstrapMs = 2U * 1000U;
constexpr UINT kSpotifyHealthyAuditMs = 60U * 60U * 1000U;
constexpr UINT kSpotifySchedulerFloorMs = 100U;
constexpr ULONGLONG kSpotifyRecoveryRetryMs = 5ULL * 1000ULL;
constexpr ULONGLONG kSpotifyControllerRetryMs = 20ULL * 1000ULL;
constexpr ULONGLONG kSpotifyAsyncOperationTimeoutMs = 30ULL * 1000ULL;
constexpr wchar_t kSpotifyStatusWindowClass[] = L"HomePanelNativeSpotifyStatus";

void InvalidateSpotifyStatusForHost(HWND hostWindow) noexcept {
  if (!hostWindow || !IsWindow(hostWindow)) return;
  HWND parent = GetParent(hostWindow);
  if (!parent || !IsWindow(parent)) return;
  HWND status = FindWindowExW(parent, nullptr, kSpotifyStatusWindowClass, nullptr);
  if (status && IsWindow(status)) InvalidateRect(status, nullptr, FALSE);
}

bool SpotifyUrlStartsWith(std::wstring_view value,
                          std::wstring_view prefix) noexcept {
  if (value.size() < prefix.size()) return false;
  for (size_t i = 0; i < prefix.size(); ++i) {
    if (towlower(value[i]) != towlower(prefix[i])) return false;
  }
  return true;
}

bool IsSpotifyOpenSource(std::wstring_view source) noexcept {
  return SpotifyUrlStartsWith(source, L"https://open.spotify.com/");
}

}  // namespace

bool SpotifyWebViews::SlotStateIsHealthy(SlotState state) noexcept {
  return state == SlotState::Playing;
}

bool SpotifyWebViews::SlotStateNeedsRecovery(SlotState state) noexcept {
  return state == SlotState::NotCreated || state == SlotState::Navigating ||
         state == SlotState::WaitingTarget || state == SlotState::Recovering;
}

void SpotifyWebViews::SetSlotState(Slot& slot, SlotState state) noexcept {
  slot.state = state;
  SetSpotifyMemoryUsageTarget(
      slot.webview.Get(),
      state == SlotState::Playing
          ? COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW
          : COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL);
  if (state == SlotState::NotCreated || state == SlotState::Authenticating ||
      state == SlotState::Playing) {
    slot.nextRecoveryTick = 0;
  }
}

void SpotifyWebViews::MarkSlotRecovering(
    Slot& slot, ULONGLONG now) noexcept {
  SetSlotState(slot, SlotState::Recovering);
  slot.nextRecoveryTick = now + kSpotifyRecoveryRetryMs;
}

bool SpotifyWebViews::ExpireStaleAsyncWork(
    Slot& slot, ULONGLONG now) noexcept {
  if (slot.asyncWork == AsyncWork::None || slot.asyncStartedTick == 0 ||
      now - slot.asyncStartedTick < kSpotifyAsyncOperationTimeoutMs) {
    return false;
  }

  const bool observerExpired = slot.asyncWork == AsyncWork::Observer;
  ++slot.asyncEpoch;
  if (slot.asyncEpoch == 0) ++slot.asyncEpoch;
  slot.asyncWork = AsyncWork::None;
  slot.asyncStartedTick = 0;
  if (observerExpired) slot.timedObserverReady = false;
  MarkSlotRecovering(slot, now);
  return true;
}

void SpotifyWebViews::BumpSpotifyTargetGeneration(Slot& slot) noexcept {
  ++slot.targetGeneration;
  if (slot.targetGeneration == 0) ++slot.targetGeneration;
  slot.playRecoveryReloadGeneration = 0;
}

void CALLBACK SpotifyWebViews::SchedulerTimerProc(
    PTP_CALLBACK_INSTANCE, PVOID context, PTP_TIMER) {
  auto* owner = static_cast<SpotifyWebViews*>(context);
  if (!owner) return;

  HWND host = owner->schedulerHost_.load(std::memory_order_acquire);
  if (!host) return;

  bool expected = false;
  if (!owner->schedulerWakePosted_.compare_exchange_strong(
          expected, true, std::memory_order_acq_rel)) {
    return;
  }
  if (!PostMessageW(host, kSpotifySchedulerMessage, 0, 0)) {
    owner->schedulerWakePosted_.store(false, std::memory_order_release);
  }
}

UINT SpotifyWebViews::NextRobustSchedulerDelayMs(
    ULONGLONG now) const noexcept {
  if (!initialCloudPlaylistReady_) return kSpotifySchedulerBootstrapMs;

  // Healthy playback normally wakes at its exact completion deadline. The
  // one-hour ceiling is only a coarse safety audit for unexpected state loss.
  ULONGLONG nextDelayMs = kSpotifyHealthyAuditMs;
  const auto considerTick = [&nextDelayMs, now](ULONGLONG dueTick) noexcept {
    if (dueTick == 0) return;
    nextDelayMs = std::min(
        nextDelayMs, dueTick <= now ? 0ULL : dueTick - now);
  };

  for (const Slot& slot : slots_) {
    // The top Spotify status has one source of truth: a fixed 60-second poll.
    if (slot.webview) {
      considerTick(slot.nextProcessTitlePollTick == 0
                       ? now
                       : slot.nextProcessTitlePollTick);
    }
    if (slot.timedCompletionDeadlineTick != 0 &&
        slot.timedCompletionDeadlineGeneration == slot.targetGeneration &&
        CurrentMusicTrack(slot)) {
      considerTick(slot.timedCompletionDeadlineTick);
    }

    if (slot.asyncWork != AsyncWork::None && slot.asyncStartedTick != 0) {
      considerTick(slot.asyncStartedTick + kSpotifyAsyncOperationTimeoutMs);
    }
    if (!slot.webview && slot.controllerCreateTick != 0) {
      considerTick(slot.controllerCreateTick + kSpotifyControllerRetryMs);
    }

    if (CurrentMusicTrack(slot) && SlotStateNeedsRecovery(slot.state) &&
        !slot.loginPage && slot.asyncWork == AsyncWork::None) {
      if (slot.nextRecoveryTick == 0) {
        nextDelayMs = 0;
      } else {
        considerTick(slot.nextRecoveryTick);
      }
    }
  }

  if (scheduleStartTick_ != 0) {
    for (size_t i = 0; i < slots_.size(); ++i) {
      const ULONGLONG boundary =
          scheduleStartTick_ +
          static_cast<ULONGLONG>(i) * kSpotifyAccountStartOffsetMs;
      if (now < boundary) {
        considerTick(boundary);
        continue;
      }

      const Slot& slot = slots_[i];
      if (slot.timedRotationActive || slot.loginPage ||
          !slot.hostWindow || !IsWindow(slot.hostWindow)) {
        continue;
      }
      if (!slot.webview) {
        if (slot.controllerCreating) continue;
        if (slot.controllerCreateTick != 0 &&
            now - slot.controllerCreateTick < kSpotifyControllerRetryMs) {
          continue;
        }
      }
      nextDelayMs = 0;
    }
  }

  return static_cast<UINT>(std::max<ULONGLONG>(
      kSpotifySchedulerFloorMs,
      std::min<ULONGLONG>(kSpotifyHealthyAuditMs, nextDelayMs)));
}

void SpotifyWebViews::ArmRobustScheduler() noexcept {
  if (!schedulerTimer_) {
    schedulerTimer_ = CreateThreadpoolTimer(
        &SpotifyWebViews::SchedulerTimerProc, this, nullptr);
    if (!schedulerTimer_) return;
  }

  if (!started_ || networkBlocked_) {
    SetThreadpoolTimer(schedulerTimer_, nullptr, 0, 0);
    return;
  }
  HWND host = schedulerHost_.load(std::memory_order_acquire);
  if (!host || !IsWindow(host)) {
    SetThreadpoolTimer(schedulerTimer_, nullptr, 0, 0);
    return;
  }

  const UINT delayMs = NextRobustSchedulerDelayMs(GetTickCount64());
  LARGE_INTEGER relativeDue{};
  relativeDue.QuadPart =
      -static_cast<LONGLONG>(static_cast<ULONGLONG>(delayMs) * 10000ULL);
  FILETIME due{};
  due.dwLowDateTime = relativeDue.LowPart;
  due.dwHighDateTime = relativeDue.HighPart;
  SetThreadpoolTimer(schedulerTimer_, &due, 0, 0);
}

bool SpotifyWebViews::SlotIsLoginPage(const Slot& slot) const noexcept {
  return slot.webview && slot.loginPage;
}

void SpotifyWebViews::BeginControllerCreate(Slot& slot) noexcept {
  if (!slot.hostWindow || !IsWindow(slot.hostWindow) ||
      slot.controller || slot.webview) {
    slot.controllerCreating = false;
    slot.controllerCreateTick = 0;
    return;
  }

  const ULONGLONG now = GetTickCount64();
  if (slot.controllerCreateTick != 0 &&
      now - slot.controllerCreateTick < kSpotifyControllerRetryMs) {
    return;
  }

  CreateController(slot);
}

}  // namespace hp
