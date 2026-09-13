// SlotState is the queue. No separate container or ownership lease is needed:
// each scheduler pass scans from the previous slot and starts at most one piece
// of WebView work. The single adaptive threadpool timer wakes only when the next
// retry, startup boundary, async timeout, completion deadline, or audit is due.

void SpotifyWebViews::StartAutonomousSchedule(ULONGLONG now) noexcept {
  if (!started_ || networkBlocked_ || slots_.empty()) return;
  if (now == 0) now = GetTickCount64();

  BeginInitialCloudPlaylistWait(now);
  EnsureCloudPlaylistLoaded();
  robustSchedulerStarted_ = true;
  schedulerCursor_ = slots_.size() - 1;
  scheduleStartTick_ = 0;

  for (size_t i = 1; i < slots_.size(); ++i) {
    slots_[i].controllerCreating = false;
    slots_[i].controllerCreateTick = 0;
    if (!slots_[i].webview) SetSlotState(slots_[i], SlotState::NotCreated);
  }

  RunStaggeredReconcile();
  ArmRobustScheduler();
}

void SpotifyWebViews::RunStaggeredReconcile() noexcept {
  if (!started_ || networkBlocked_ || slots_.empty()) return;

  const ULONGLONG now = GetTickCount64();

  EnsureCloudPlaylistLoaded();
  if (!InitialCloudPlaylistReady(now)) return;
  if (scheduleStartTick_ == 0) scheduleStartTick_ = now;

  ProbeDueTimedCompletions(now);
  EnsureCloudPlaylistLoaded();

  for (Slot& candidate : slots_) {
    ExpireStaleAsyncWork(candidate, now);
  }

  const ULONGLONG elapsed = now - scheduleStartTick_;
  const size_t count = slots_.size();
  const size_t scanStart = (schedulerCursor_ + 1) % count;

  const auto startupReady = [elapsed](size_t index) noexcept {
    return elapsed >= static_cast<ULONGLONG>(index) *
                          kSpotifyAccountStartOffsetMs;
  };
  const auto retryReady = [now](const Slot& slot) noexcept {
    return slot.lastTimedReconcileTick == 0 ||
           now - slot.lastTimedReconcileTick >= kSpotifyQueueRetryMs;
  };
  const auto asyncIdle = [](const Slot& slot) noexcept {
    return !slot.reconcileInFlight && !slot.timedObserverInstallInFlight;
  };
  const auto controllerReady = [now](const Slot& slot) noexcept {
    if (slot.webview) return true;
    if (slot.controllerCreating) return false;
    return slot.controllerCreateTick == 0 ||
           now - slot.controllerCreateTick >= kSpotifyRobustControllerRetryMs;
  };

  size_t selected = count;

  for (size_t step = 0; step < count; ++step) {
    const size_t index = (scanStart + step) % count;
    const Slot& candidate = slots_[index];
    if (!startupReady(index) || candidate.state != SlotState::Recovering ||
        !controllerReady(candidate) || !asyncIdle(candidate) ||
        !retryReady(candidate)) {
      continue;
    }
    selected = index;
    break;
  }

  if (selected == count) {
    for (size_t step = 0; step < count; ++step) {
      const size_t index = (scanStart + step) % count;
      const Slot& candidate = slots_[index];
      if (!startupReady(index) || !controllerReady(candidate)) continue;
      const bool pending = !candidate.timedRotationActive ||
                           SlotStateNeedsRecovery(candidate.state);
      if (!pending) continue;
      if (candidate.timedRotationActive &&
          (!asyncIdle(candidate) || !retryReady(candidate))) {
        continue;
      }
      selected = index;
      break;
    }
  }

  if (selected == count) {
    for (size_t step = 0; step < count; ++step) {
      const size_t index = (scanStart + step) % count;
      const Slot& candidate = slots_[index];
      if (!startupReady(index) || !CurrentMusicTrack(candidate) ||
          SlotIsLoginPage(candidate) || !asyncIdle(candidate)) {
        continue;
      }
      selected = index;
      break;
    }
  }

  if (selected == count) return;

  schedulerCursor_ = selected;
  Slot& slot = slots_[selected];
  if (!slot.hostWindow || !IsWindow(slot.hostWindow)) return;

  RefreshSpotifyHostLayout();
  if (slot.webview && SlotIsLoginPage(slot)) return;

  if (!slot.timedRotationActive) {
    if (!slot.webview) {
      BeginControllerCreate(slot);
      return;
    }
    InitializeTimedRotationSlot(slot);
    if (CurrentMusicTrack(slot)) NavigateMusicTarget(slot);
    return;
  }

  if (!CurrentMusicTrack(slot)) {
    slot.timedRotationActive = false;
    ArmRobustScheduler();
    return;
  }

  slot.lastTimedReconcileTick = now;
  ArmTimedEndObserver(slot);
  ReconcileMusicTarget(slot);
}