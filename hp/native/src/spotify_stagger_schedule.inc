namespace {
// SlotState is the queue. No separate container or ownership lease is needed:
// each scheduler pass scans from the previous slot and runs at most one piece of
// DOM work. Recovery retries stay sparse even though the shared timer wakes
// every two seconds while any slot is unhealthy.
constexpr ULONGLONG kSpotifyQueueRetryMs = 4ULL * 1000ULL;
}  // namespace

void CALLBACK SpotifyWebViews::StaggeredReconcileTimerProc(
    HWND hwnd, UINT, UINT_PTR timerId, DWORD) {
  if (timerId != kSpotifyRobustReconcileTimer || !hwnd || !IsWindow(hwnd)) {
    return;
  }
  auto* slot = reinterpret_cast<Slot*>(GetWindowLongPtrW(hwnd, GWLP_USERDATA));
  if (!slot || !slot->owner || slot->index != 0) return;
  SpotifyWebViews* const owner = slot->owner;
  owner->RunStaggeredReconcile();
  owner->ArmRobustScheduler();
}

void SpotifyWebViews::StartAutonomousSchedule(ULONGLONG now) noexcept {
  if (!started_ || networkBlocked_ || slots_.empty()) return;
  if (now == 0) now = GetTickCount64();

  // Capture the pre-CloudClient cache state. Renderer starts Spotify immediately
  // before CloudClient starts its first synchronization, so a subsequent file
  // creation/replacement is an unambiguous fresh-config signal.
  BeginInitialCloudPlaylistWait(now);
  EnsureCloudPlaylistLoaded();
  robustSchedulerStarted_ = true;
  schedulerCursor_ = slots_.size() - 1;
  scheduleStartTick_ = 0;

  // Only slot 0 is allowed to start controller creation immediately. Remaining
  // accounts become queue-eligible at their ten-second startup boundaries.
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

  // Startup staggering begins only after the initial cloud-config gate opens.
  if (scheduleStartTick_ == 0) scheduleStartTick_ = now;

  // Track completion is independent per WebView and remains deadline-driven.
  ProbeDueTimedCompletions(now);
  EnsureCloudPlaylistLoaded();

  // Lost ExecuteScript callbacks become ordinary Recovering queue entries.
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

  size_t selected = count;

  // First priority: explicit recovery. Round-robin scanning prevents one slow
  // WebView from monopolizing the shared DOM lane.
  for (size_t step = 0; step < count; ++step) {
    const size_t index = (scanStart + step) % count;
    const Slot& candidate = slots_[index];
    if (!startupReady(index) || candidate.state != SlotState::Recovering ||
        !retryReady(candidate)) {
      continue;
    }
    selected = index;
    break;
  }

  // Second priority: startup/navigation/target work already represented by the
  // slot state. This is the implicit queue; no mirrored pending-work structure.
  if (selected == count) {
    for (size_t step = 0; step < count; ++step) {
      const size_t index = (scanStart + step) % count;
      const Slot& candidate = slots_[index];
      if (!startupReady(index)) continue;
      const bool pending = !candidate.timedRotationActive ||
                           SlotStateNeedsRecovery(candidate.state);
      if (!pending) continue;
      if (candidate.timedRotationActive && !retryReady(candidate)) continue;
      selected = index;
      break;
    }
  }

  // No work is queued: use the existing 60-second healthy scheduler wake as a
  // low-frequency safety audit, one account per wake.
  if (selected == count) {
    for (size_t step = 0; step < count; ++step) {
      const size_t index = (scanStart + step) % count;
      const Slot& candidate = slots_[index];
      if (!startupReady(index) || !candidate.timedRotationActive ||
          candidate.timedTarget == TimedSpotifyTarget::None ||
          SlotIsLoginPage(candidate)) {
        continue;
      }
      selected = index;
      break;
    }
  }

  if (selected == count) return;

  // One cursor is enough: it is both the round-robin starting point and the
  // recovery layout slot for this pass. There is no ownership lease or hold.
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
    return;
  }

  slot.lastTimedReconcileTick = now;
  ArmTimedEndObserver(slot);
  ReconcileActiveTimedSlot(slot);
}