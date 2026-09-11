namespace hp {
namespace {

constexpr UINT_PTR kSpotifyRobustReconcileTimer = 0x53505243;
constexpr UINT kSpotifyRobustUrgentTickMs = 2U * 1000U;
constexpr UINT kSpotifyRobustHealthyTickMs = 40U * 1000U;
constexpr ULONGLONG kSpotifyRobustNavigateRetryMs = 20ULL * 1000ULL;
constexpr ULONGLONG kSpotifyRobustControllerRetryMs = 20ULL * 1000ULL;
constexpr ULONGLONG kSpotifyUnhealthyRenavigateMs = 30ULL * 1000ULL;
constexpr ULONGLONG kSpotifyAsyncOperationTimeoutMs = 12ULL * 1000ULL;

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
  return state == SlotState::Playing || state == SlotState::Completed;
}

bool SpotifyWebViews::SlotStateNeedsRecovery(SlotState state) noexcept {
  return state == SlotState::NotCreated || state == SlotState::Navigating ||
         state == SlotState::WaitingTarget || state == SlotState::Recovering;
}

void SpotifyWebViews::SetSlotState(Slot& slot, SlotState state) noexcept {
  slot.state = state;
  if (state == SlotState::NotCreated || state == SlotState::Authenticating ||
      state == SlotState::Navigating || state == SlotState::Playing ||
      state == SlotState::Completed) {
    slot.unhealthySinceTick = 0;
  }
}

void SpotifyWebViews::MarkSlotRecovering(
    Slot& slot, ULONGLONG now) noexcept {
  slot.state = SlotState::Recovering;
  if (slot.unhealthySinceTick == 0) slot.unhealthySinceTick = now;
}

bool SpotifyWebViews::ShouldRenavigateUnhealthySlot(
    const Slot& slot, ULONGLONG now) const noexcept {
  return slot.unhealthySinceTick != 0 &&
         now - slot.unhealthySinceTick >= kSpotifyUnhealthyRenavigateMs &&
         (slot.lastModeNavigateTick == 0 ||
          now - slot.lastModeNavigateTick >= kSpotifyRobustNavigateRetryMs);
}

bool SpotifyWebViews::ExpireStaleAsyncWork(
    Slot& slot, ULONGLONG now) noexcept {
  bool expired = false;
  if (slot.reconcileInFlight && slot.reconcileStartedTick != 0 &&
      now - slot.reconcileStartedTick >= kSpotifyAsyncOperationTimeoutMs) {
    ++slot.reconcileRequestGeneration;
    if (slot.reconcileRequestGeneration == 0) ++slot.reconcileRequestGeneration;
    slot.reconcileInFlight = false;
    slot.reconcileStartedTick = 0;
    expired = true;
  }
  if (slot.timedObserverInstallInFlight &&
      slot.timedObserverInstallStartedTick != 0 &&
      now - slot.timedObserverInstallStartedTick >=
          kSpotifyAsyncOperationTimeoutMs) {
    ++slot.timedObserverInstallGeneration;
    if (slot.timedObserverInstallGeneration == 0) {
      ++slot.timedObserverInstallGeneration;
    }
    slot.timedObserverInstallInFlight = false;
    slot.timedObserverInstallStartedTick = 0;
    slot.timedObserverReady = false;
    expired = true;
  }
  if (!expired) return false;

  MarkSlotRecovering(slot, now);
  slot.lastTimedReconcileTick = 0;
  staggerSlotIndex_ = slot.index;
  staggerSlotStartTick_ = now;
  staggerSlotValidated_ = false;
  return true;
}

void SpotifyWebViews::BumpSpotifyTargetGeneration(Slot& slot) noexcept {
  ++slot.targetGeneration;
  if (slot.targetGeneration == 0) ++slot.targetGeneration;
}

UINT SpotifyWebViews::NextRobustSchedulerDelayMs(
    ULONGLONG now) const noexcept {
  if (!robustSchedulerStarted_) return kSpotifyRobustUrgentTickMs;

  ULONGLONG nextDeadlineMs = kSpotifyRobustHealthyTickMs;
  for (const Slot& slot : slots_) {
    const bool relevantRecovery =
        SlotStateNeedsRecovery(slot.state) &&
        (slot.timedTarget != TimedSpotifyTarget::None ||
         slot.loginPage || slot.controllerCreating);
    if (relevantRecovery) return kSpotifyRobustUrgentTickMs;

    if (slot.reconcileInFlight && slot.reconcileStartedTick != 0) {
      const ULONGLONG age = now - slot.reconcileStartedTick;
      if (age >= kSpotifyAsyncOperationTimeoutMs) {
        return kSpotifyRobustUrgentTickMs;
      }
      nextDeadlineMs = std::min(
          nextDeadlineMs, kSpotifyAsyncOperationTimeoutMs - age);
    }
    if (slot.timedObserverInstallInFlight &&
        slot.timedObserverInstallStartedTick != 0) {
      const ULONGLONG age = now - slot.timedObserverInstallStartedTick;
      if (age >= kSpotifyAsyncOperationTimeoutMs) {
        return kSpotifyRobustUrgentTickMs;
      }
      nextDeadlineMs = std::min(
          nextDeadlineMs, kSpotifyAsyncOperationTimeoutMs - age);
    }
  }

  if (scheduleStartTick_ != 0 && now >= scheduleStartTick_) {
    const ULONGLONG elapsed = now - scheduleStartTick_;
    for (size_t i = 1; i < slots_.size(); ++i) {
      const ULONGLONG boundary =
          static_cast<ULONGLONG>(i) * kSpotifyAccountStartOffsetMs;
      if (elapsed < boundary) {
        nextDeadlineMs = std::min(nextDeadlineMs, boundary - elapsed);
        break;
      }
    }
  }

  return static_cast<UINT>(std::max<ULONGLONG>(
      1000ULL, std::min<ULONGLONG>(
          kSpotifyRobustHealthyTickMs, nextDeadlineMs)));
}

void SpotifyWebViews::ArmRobustScheduler() noexcept {
  if (slots_.empty()) return;
  HWND host = slots_[0].hostWindow;
  if (!host || !IsWindow(host)) return;
  KillTimer(host, kSpotifyRobustReconcileTimer);
  const UINT delay = NextRobustSchedulerDelayMs(GetTickCount64());
  ::SetTimer(host, kSpotifyRobustReconcileTimer, delay,
             &SpotifyWebViews::StaggeredReconcileTimerProc);
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
  if (slot.controllerCreating && slot.controllerCreateTick != 0 &&
      now - slot.controllerCreateTick < kSpotifyRobustControllerRetryMs) {
    return;
  }

  SetSlotState(slot, SlotState::NotCreated);
  slot.controllerCreating = true;
  slot.controllerCreateTick = now;
  CreateController(slot);
}

}  // namespace hp
