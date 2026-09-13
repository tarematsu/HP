namespace hp {
namespace {

constexpr UINT kSpotifySchedulerBootstrapMs = 2U * 1000U;
constexpr UINT kSpotifyHealthyAuditMs = 60U * 1000U;
constexpr UINT kSpotifySchedulerFloorMs = 100U;
constexpr ULONGLONG kSpotifyQueueRetryMs = 4ULL * 1000ULL;
constexpr ULONGLONG kSpotifyRobustNavigateRetryMs = 20ULL * 1000ULL;
constexpr ULONGLONG kSpotifyRobustControllerRetryMs = 20ULL * 1000ULL;
constexpr ULONGLONG kSpotifyUnhealthyRenavigateMs = 30ULL * 1000ULL;
constexpr ULONGLONG kSpotifyAsyncOperationTimeoutMs = 12ULL * 1000ULL;
constexpr ULONGLONG kSpotifyMaxInterruptionHoldMs = 5ULL * 60ULL * 1000ULL;

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

ULONGLONG SpotifyDeadlineWithInterruptionHold(
    ULONGLONG deadline, ULONGLONG interruptionStart) noexcept {
  if (deadline == 0 || interruptionStart == 0) return deadline;
  const ULONGLONG maxTick = (std::numeric_limits<ULONGLONG>::max)();
  const ULONGLONG holdUntil = interruptionStart >
          maxTick - kSpotifyMaxInterruptionHoldMs
      ? maxTick
      : interruptionStart + kSpotifyMaxInterruptionHoldMs;
  return std::max(deadline, holdUntil);
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
  const bool changed = slot.state != state;
  if (changed && state == SlotState::Playing) {
    slot.lastPlaybackStartedAt = UnixMillis();
  }
  slot.state = state;
  if (state == SlotState::NotCreated || state == SlotState::Authenticating ||
      state == SlotState::Navigating || state == SlotState::Playing) {
    slot.unhealthySinceTick = 0;
  }
  if (changed) NotifyPlaybackTelemetryChanged();
}

void SpotifyWebViews::MarkSlotRecovering(
    Slot& slot, ULONGLONG now) noexcept {
  const bool changed = slot.state != SlotState::Recovering;
  slot.state = SlotState::Recovering;
  if (slot.unhealthySinceTick == 0) slot.unhealthySinceTick = now;
  if (changed) NotifyPlaybackTelemetryChanged();
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
  return true;
}

void SpotifyWebViews::BumpSpotifyTargetGeneration(Slot& slot) noexcept {
  ++slot.targetGeneration;
  if (slot.targetGeneration == 0) ++slot.targetGeneration;
  slot.lastPlaybackStartedAt = 0;
  NotifyPlaybackTelemetryChanged();
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
  if (!robustSchedulerStarted_ || !initialCloudPlaylistReady_) {
    return kSpotifySchedulerBootstrapMs;
  }

  ULONGLONG nextDelayMs = kSpotifyHealthyAuditMs;
  const auto considerTick = [&nextDelayMs, now](ULONGLONG dueTick) noexcept {
    if (dueTick == 0) return;
    nextDelayMs = std::min(
        nextDelayMs, dueTick <= now ? 0ULL : dueTick - now);
  };

  if (playbackTelemetryDirty_) {
    if (lastPlaybackTelemetryPostTick_ == 0) {
      nextDelayMs = 0;
    } else {
      considerTick(
          lastPlaybackTelemetryPostTick_ + kSpotifyPlaybackTelemetryMinIntervalMs);
    }
  }

  for (const Slot& slot : slots_) {
    if (slot.timedCompletionDeadlineTick != 0 &&
        slot.timedCompletionDeadlineGeneration == slot.targetGeneration &&
        CurrentMusicTrack(slot)) {
      considerTick(SpotifyDeadlineWithInterruptionHold(
          slot.timedCompletionDeadlineTick, slot.timedInterruptionStartTick));
    }

    if (slot.reconcileInFlight && slot.reconcileStartedTick != 0) {
      considerTick(slot.reconcileStartedTick + kSpotifyAsyncOperationTimeoutMs);
    }
    if (slot.timedObserverInstallInFlight &&
        slot.timedObserverInstallStartedTick != 0) {
      considerTick(
          slot.timedObserverInstallStartedTick + kSpotifyAsyncOperationTimeoutMs);
    }
    if (!slot.webview && slot.controllerCreateTick != 0) {
      considerTick(slot.controllerCreateTick + kSpotifyRobustControllerRetryMs);
    }

    const bool queueReady =
        CurrentMusicTrack(slot) && SlotStateNeedsRecovery(slot.state) &&
        !slot.loginPage && !slot.reconcileInFlight &&
        !slot.timedObserverInstallInFlight;
    if (queueReady) {
      if (slot.lastTimedReconcileTick == 0) {
        nextDelayMs = 0;
      } else {
        considerTick(slot.lastTimedReconcileTick + kSpotifyQueueRetryMs);
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
            now - slot.controllerCreateTick < kSpotifyRobustControllerRetryMs) {
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
      now - slot.controllerCreateTick < kSpotifyRobustControllerRetryMs) {
    return;
  }

  SetSlotState(slot, SlotState::NotCreated);
  slot.controllerCreating = true;
  slot.controllerCreateTick = now;
  CreateController(slot);
}

}  // namespace hp
