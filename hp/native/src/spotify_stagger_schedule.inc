// SlotState is the queue. Each scheduler pass scans once from the previous slot
// and starts at most one piece of WebView work. The adaptive timer wakes only
// for startup, recovery, async timeout, completion deadline, or the healthy audit.

namespace {
constexpr ULONGLONG kSpotifyInitialStartDelayMs = 0;
constexpr ULONGLONG kSpotifyCloudReloadMinIntervalMs = 60ULL * 1000ULL;
}

void SpotifyWebViews::StartAutonomousSchedule(ULONGLONG now) noexcept {
  if (!started_ || networkBlocked_ || slots_.empty()) return;
  if (now == 0) now = GetTickCount64();

  BeginInitialCloudPlaylistWait(now);
  nextCloudPlaylistCheckTick_ = 0;
  schedulerCursor_ = slots_.size() - 1;
  scheduleStartTick_ = now + kSpotifyInitialStartDelayMs;

  RunStaggeredReconcile();
  ArmRobustScheduler();
}

void SpotifyWebViews::RunStaggeredReconcile() noexcept {
  if (!started_ || networkBlocked_ || slots_.empty()) return;

  const ULONGLONG now = GetTickCount64();
  PollProcessTitleStatus(now);
  const bool cloudPlaylistWasReady = initialCloudPlaylistReady_;
  const bool cloudPlaylistReady = InitialCloudPlaylistReady(now);
  if (!cloudPlaylistWasReady && cloudPlaylistReady) {
    nextCloudPlaylistCheckTick_ = now + kSpotifyCloudReloadMinIntervalMs;
  } else if (cloudPlaylistWasReady && cloudPlaylistReady &&
             (nextCloudPlaylistCheckTick_ == 0 ||
              now >= nextCloudPlaylistCheckTick_)) {
    EnsureCloudPlaylistLoaded();
    nextCloudPlaylistCheckTick_ = now + kSpotifyCloudReloadMinIntervalMs;
  }
  if (scheduleStartTick_ == 0) {
    scheduleStartTick_ = now + kSpotifyInitialStartDelayMs;
  }
  if (now < scheduleStartTick_) return;

  ProbeDueTimedCompletions(now);
  for (Slot& slot : slots_) ExpireStaleAsyncWork(slot, now);

  const size_t count = slots_.size();
  const size_t scanStart = (schedulerCursor_ + 1) % count;

  const auto startupReady = [this, now](size_t index) noexcept {
    const ULONGLONG boundary =
        scheduleStartTick_ +
        static_cast<ULONGLONG>(index) * kSpotifyAccountStartOffsetMs;
    return now >= boundary;
  };
  const auto controllerReady = [now](const Slot& slot) noexcept {
    if (slot.webview) return true;
    if (slot.controllerCreating) return false;
    return slot.controllerCreateTick == 0 ||
           now - slot.controllerCreateTick >= kSpotifyControllerRetryMs;
  };
  const auto recoveryReady = [now](const Slot& slot) noexcept {
    return slot.nextRecoveryTick == 0 || now >= slot.nextRecoveryTick;
  };
  const auto healthyPlaybackNeedsNoWork = [](const Slot& slot) noexcept {
    return SlotStateIsHealthy(slot.state) &&
           slot.timedCompletionDeadlineTick != 0 &&
           slot.timedCompletionDeadlineGeneration == slot.targetGeneration;
  };

  size_t selected = count;
  for (size_t step = 0; step < count; ++step) {
    const size_t index = (scanStart + step) % count;
    if (!SpotifyAccountShouldOwnHost(index)) continue;
    const Slot& candidate = slots_[index];
    if (!startupReady(index) || !controllerReady(candidate) ||
        SlotIsLoginPage(candidate)) {
      continue;
    }
    if (!candidate.timedRotationActive || !CurrentMusicTrack(candidate)) {
      selected = index;
      break;
    }
    if (healthyPlaybackNeedsNoWork(candidate) ||
        candidate.asyncWork != AsyncWork::None) {
      continue;
    }
    if (SlotStateNeedsRecovery(candidate.state) && !recoveryReady(candidate)) {
      continue;
    }
    selected = index;
    break;
  }

  if (selected == count) return;

  schedulerCursor_ = selected;
  Slot& slot = slots_[selected];
  if (!slot.hostWindow || !IsWindow(slot.hostWindow)) {
    if (!CreateHost(slot)) return;
  }

  RefreshSpotifyHostLayout();

  if (!slot.timedRotationActive) {
    if (!slot.webview) {
      BeginControllerCreate(slot);
      return;
    }
    if (!cloudPlaylistReady) return;
    InitializeTimedRotationSlot(slot);
    if (CurrentMusicTrack(slot)) NavigateMusicTarget(slot);
    return;
  }

  if (!CurrentMusicTrack(slot)) {
    slot.timedRotationActive = false;
    ArmRobustScheduler();
    return;
  }

  ReconcileMusicTarget(slot);
}
