namespace {
// One healthy slot is verified per turn. With the adaptive 40-second scheduler
// this is one lightweight verification per account roughly every four minutes.
constexpr ULONGLONG kSpotifySimpleSteadyTurnMs = 40ULL * 1000ULL;
// A recovery owner gets enough time for one 12-second async timeout plus a
// layout-settled retry before normal healthy-account fairness resumes.
constexpr ULONGLONG kSpotifySimpleRecoveryHoldMs = 36ULL * 1000ULL;
constexpr ULONGLONG kSpotifySimpleLayoutSettleMs = 2ULL * 1000ULL;
constexpr ULONGLONG kSpotifySimpleRetryMs = 4ULL * 1000ULL;

size_t SimpleSpotifyScheduledIndex(
    ULONGLONG elapsed, size_t accountCount) noexcept {
  if (accountCount == 0) return 0;
  const ULONGLONG initialSerialWindowMs =
      static_cast<ULONGLONG>(accountCount) * kSpotifyAccountStartOffsetMs;
  if (elapsed < initialSerialWindowMs) {
    return static_cast<size_t>(std::min<ULONGLONG>(
        static_cast<ULONGLONG>(accountCount - 1),
        elapsed / kSpotifyAccountStartOffsetMs));
  }
  return static_cast<size_t>(
      ((elapsed - initialSerialWindowMs) /
       kSpotifySimpleSteadyTurnMs) % accountCount);
}
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
  // SetTimer is intentionally re-armed after each pass so healthy operation can
  // sleep at the adaptive cadence while a recovery event immediately returns it
  // to the two-second cadence.
  owner->ArmRobustScheduler();
}

void SpotifyWebViews::StartAutonomousSchedule(ULONGLONG now) noexcept {
  if (!started_ || networkBlocked_ || slots_.empty()) return;
  if (now == 0) now = GetTickCount64();

  EnsureCloudPlaylistLoaded();
  robustSchedulerStarted_ = true;
  staggerSlotIndex_ = 0;
  staggerSlotStartTick_ = now;
  scheduleStartTick_ = now;
  staggerSlotValidated_ = false;

  // Only slot 0 is allowed to start controller creation immediately. The other
  // accounts enter through the same serialized ownership schedule.
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
  if (scheduleStartTick_ == 0) scheduleStartTick_ = now;
  if (staggerSlotStartTick_ == 0) staggerSlotStartTick_ = now;

  // device-config.json is atomically replaced by the existing CloudClient sync.
  // A timestamp check is cheap and makes Spotify consume the synchronized
  // settings without restarting HomePanel.
  EnsureCloudPlaylistLoaded();

  // ExecuteScript completion callbacks are not a lifetime guarantee. If WebView2
  // drops one, invalidate that request generation and immediately give the
  // affected account serialized recovery ownership instead of leaving an
  // in-flight boolean stuck for the lifetime of the process.
  for (Slot& candidate : slots_) {
    if (ExpireStaleAsyncWork(candidate, now)) {
      RecomputeForeground();
      break;
    }
  }

  // TALKABOUT owns an independent restart-safe cloud-configured deadline. Music
  // itself advances only from the natural ended event.
  if (StartOverduePodcastBreak(now)) return;

  const ULONGLONG elapsed = now - scheduleStartTick_;

  staggerSlotIndex_ %= slots_.size();
  Slot& current = slots_[staggerSlotIndex_];
  const bool holdRecovery =
      current.timedTarget != TimedSpotifyTarget::None &&
      SlotStateNeedsRecovery(current.state) &&
      now - staggerSlotStartTick_ < kSpotifySimpleRecoveryHoldMs;
  const size_t scheduledIndex =
      SimpleSpotifyScheduledIndex(elapsed, slots_.size());

  // Login is a presentation concern, not scheduler ownership. A login surface
  // stays foreground through RefreshSpotifyHostLayout(), while the normal turn
  // schedule and event-driven recovery for the other accounts continue.
  if (!holdRecovery && staggerSlotIndex_ != scheduledIndex) {
    staggerSlotIndex_ = scheduledIndex;
    staggerSlotStartTick_ = now;
    staggerSlotValidated_ = false;
  }

  if (staggerSlotIndex_ >= slots_.size()) return;
  Slot& slot = slots_[staggerSlotIndex_];
  if (!slot.hostWindow || !IsWindow(slot.hostWindow)) return;
  // One layout pass observes the final owner for this scheduler turn. The old
  // path refreshed once during ownership handoff and immediately again here.
  RefreshSpotifyHostLayout();
  // An auth-owned turn performs no playback DOM work. The visible auth window
  // remains independent, and observer/timer events from other slots stay live.
  if (slot.webview && SlotIsLoginPage(slot)) return;

  const ULONGLONG slotOffset =
      static_cast<ULONGLONG>(slot.index) * kSpotifyAccountStartOffsetMs;
  if (elapsed < slotOffset) return;

  // Spotify playback no longer depends on the YouTube/TVer phase. Once an
  // account reaches its serialized start turn, it owns an autonomous
  // cloud-defined rotation for the rest of its lifetime.
  if (!slot.timedRotationActive) {
    if (!slot.webview) {
      BeginControllerCreate(slot);
      return;
    }
    InitializeTimedRotationSlot(slot, now);
    return;
  }

  if (SlotStateNeedsRecovery(slot.state) &&
      now - staggerSlotStartTick_ < kSpotifySimpleLayoutSettleMs) {
    return;
  }

  // Healthy accounts get one verification on their ownership turn. Recovery is
  // event-driven and retries only the affected account every four seconds.
  if (!staggerSlotValidated_ || SlotStateNeedsRecovery(slot.state)) {
    if (slot.lastTimedReconcileTick == 0 ||
        now - slot.lastTimedReconcileTick >= kSpotifySimpleRetryMs) {
      slot.lastTimedReconcileTick = now;
      if (slot.timedTarget != TimedSpotifyTarget::TalkAbout) {
        ArmTimedEndObserver(slot);
      }
      staggerSlotValidated_ = true;
      ReconcileActiveTimedSlot(slot);
    }
  }
}
