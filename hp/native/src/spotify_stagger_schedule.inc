namespace {
constexpr ULONGLONG kSpotifyTimedSlotOffsetMs = 40ULL * 1000ULL;
constexpr ULONGLONG kSpotifyTimedTalkAboutStartMs = 4ULL * 60ULL * 1000ULL;
constexpr ULONGLONG kSpotifyTimedRotationStartMs = 20ULL * 60ULL * 1000ULL;
constexpr ULONGLONG kSpotifyInitialSerialWindowMs = 6ULL * 40ULL * 1000ULL;
// One healthy slot is verified per turn. With the adaptive 20-second scheduler
// this is one lightweight verification per account roughly every two minutes.
constexpr ULONGLONG kSpotifySimpleSteadyTurnMs = 20ULL * 1000ULL;
constexpr ULONGLONG kSpotifySimpleRecoveryHoldMs = 12ULL * 1000ULL;
constexpr ULONGLONG kSpotifySimpleLayoutSettleMs = 2ULL * 1000ULL;
constexpr ULONGLONG kSpotifySimpleRetryMs = 4ULL * 1000ULL;

size_t SimpleSpotifyScheduledIndex(ULONGLONG elapsed) noexcept {
  if (elapsed < kSpotifyInitialSerialWindowMs) {
    return static_cast<size_t>(
        std::min<ULONGLONG>(5ULL, elapsed / kSpotifyTimedSlotOffsetMs));
  }
  return static_cast<size_t>(
      ((elapsed - kSpotifyInitialSerialWindowMs) /
       kSpotifySimpleSteadyTurnMs) % 6ULL);
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

void SpotifyWebViews::RunStaggeredReconcile() noexcept {
  if (!started_ || slots_.empty()) return;

  const ULONGLONG now = GetTickCount64();
  if (youtubeCycleStartTick_ == 0) youtubeCycleStartTick_ = now;
  if (staggerSlotStartTick_ == 0) staggerSlotStartTick_ = now;

  if (AdvanceExpiredTimedRotation(now)) return;

  const ULONGLONG elapsed = now - youtubeCycleStartTick_;

  staggerSlotIndex_ %= slots_.size();
  Slot& current = slots_[staggerSlotIndex_];
  const bool holdRecovery =
      current.timedTarget != TimedSpotifyTarget::None &&
      SlotStateNeedsRecovery(current.state) &&
      now - staggerSlotStartTick_ < kSpotifySimpleRecoveryHoldMs;
  const size_t scheduledIndex = SimpleSpotifyScheduledIndex(elapsed);

  // Login is a presentation concern, not scheduler ownership. A login surface
  // stays foreground through RefreshSpotifyHostLayout(), while the normal turn
  // schedule and event-driven recovery for the other five accounts continue.
  if (!holdRecovery && staggerSlotIndex_ != scheduledIndex) {
    staggerSlotIndex_ = scheduledIndex;
    staggerSlotStartTick_ = now;
    staggerSlotValidated_ = false;
    RefreshSpotifyHostLayout();
  }

  if (staggerSlotIndex_ >= slots_.size()) return;
  Slot& slot = slots_[staggerSlotIndex_];
  if (!slot.hostWindow || !IsWindow(slot.hostWindow)) return;
  RefreshSpotifyHostLayout();
  // An auth-owned turn performs no playback DOM work. The visible auth window
  // remains independent, and observer/timer events from other slots stay live.
  if (slot.webview && SlotIsLoginPage(slot)) return;

  const ULONGLONG slotOffset =
      static_cast<ULONGLONG>(slot.index) * kSpotifyTimedSlotOffsetMs;
  if (elapsed < slotOffset) return;
  const ULONGLONG slotLocalElapsed = elapsed - slotOffset;

  // If the WebViews were rebuilt while TVer is active, the previous rotation
  // state is necessarily gone. Do not wait for a fresh 20-minute YouTube prelude
  // clock before resuming: rebuild the completion-driven rotation immediately,
  // still one account at a time through the normal serialized ownership turns.
  if (!podcastMode_ && !slot.timedRotationActive) {
    if (!slot.webview) {
      BeginControllerCreate(slot);
      return;
    }
    InitializeTimedRotationSlot(slot, now);
    return;
  }

  if (slotLocalElapsed < kSpotifyTimedRotationStartMs) {
    TimedSpotifyTarget desired = TimedSpotifyTarget::None;
    size_t desiredCatalogIndex = kNoTimedCatalogIndex;

    if (podcastMode_ && slotLocalElapsed < kSpotifyTimedTalkAboutStartMs) {
      desired = TimedSpotifyTarget::BitterBlue;
    } else if (podcastMode_ && !slot.podcastCompleted) {
      desired = TimedSpotifyTarget::TalkAbout;
    } else if (podcastMode_ && !slot.timedBridgeCompleted) {
      if (!IsRecentCatalogIndex(timedBridgeCatalogIndex_)) {
        timedBridgeCatalogIndex_ = PickRecentCatalogIndex(
            kNoTimedCatalogIndex, kNoTimedCatalogIndex);
      }
      desired = TimedSpotifyTarget::CatalogTrack;
      desiredCatalogIndex = timedBridgeCatalogIndex_;
    } else {
      return;
    }

    const bool catalogChanged =
        desired == TimedSpotifyTarget::CatalogTrack &&
        slot.timedCatalogIndex != desiredCatalogIndex;
    if (slot.timedTarget != desired || catalogChanged) {
      slot.timedTarget = desired;
      slot.timedCatalogIndex = desiredCatalogIndex;
      BumpSpotifyTargetGeneration(slot);
      slot.lastModeNavigateTick = 0;
      slot.lastTimedReconcileTick = 0;
      slot.unhealthySinceTick = 0;
      SetSlotState(slot, SlotState::WaitingTarget);
      slot.timedPlaybackStartTick = 0;
      staggerSlotIndex_ = slot.index;
      staggerSlotStartTick_ = now;
      staggerSlotValidated_ = false;
      if (desired == TimedSpotifyTarget::BitterBlue) {
        slot.timedPreludeCompleted = false;
      }
      RefreshSpotifyHostLayout();
      if (!slot.webview) {
        BeginControllerCreate(slot);
      } else {
        NavigateActiveTimedSlot(slot);
      }
      return;
    }

    if (desired != TimedSpotifyTarget::CatalogTrack) {
      slot.timedCatalogIndex = kNoTimedCatalogIndex;
    }

    const bool recentBridge =
        slot.timedTarget == TimedSpotifyTarget::CatalogTrack &&
        IsRecentCatalogIndex(slot.timedCatalogIndex);
    if ((slot.timedTarget == TimedSpotifyTarget::BitterBlue &&
         slot.timedPreludeCompleted) ||
        (recentBridge && slot.timedBridgeCompleted)) {
      SetSlotState(slot, SlotState::Completed);
      return;
    }
  } else if (!slot.timedRotationActive) {
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

void SpotifyWebViews::SetPodcastMode(bool podcastWindowActive) noexcept {
  if (!started_ || slots_.empty()) return;

  const ULONGLONG now = GetTickCount64();
  if (!robustSchedulerStarted_) {
    robustSchedulerStarted_ = true;
    staggerSlotIndex_ = 0;
    staggerSlotStartTick_ = now;
    youtubeCycleStartTick_ = now;
    staggerSlotValidated_ = false;

    for (size_t i = 1; i < slots_.size(); ++i) {
      slots_[i].controllerCreating = false;
      slots_[i].controllerCreateTick = 0;
      if (!slots_[i].webview) {
        SetSlotState(slots_[i], SlotState::NotCreated);
      }
    }
  }
  ArmRobustScheduler();

  const bool modeChanged = podcastMode_ != podcastWindowActive;
  podcastMode_ = podcastWindowActive;
  if (modeChanged && podcastWindowActive) {
    youtubeCycleStartTick_ = now;
    staggerSlotIndex_ = 0;
    staggerSlotStartTick_ = now;
    staggerSlotValidated_ = false;
    timedRandomPairCycle_ = ~0ULL;
    timedBridgeCatalogIndex_ = kNoTimedCatalogIndex;
    timedRandomCIndex_ = kNoTimedCatalogIndex;
    timedRandomDIndex_ = kNoTimedCatalogIndex;

    for (Slot& slot : slots_) {
      slot.lastModeNavigateTick = 0;
      slot.lastTimedReconcileTick = 0;
      slot.unhealthySinceTick = 0;
      slot.podcastCompleted = false;
      slot.timedTarget = TimedSpotifyTarget::None;
      slot.timedCatalogIndex = kNoTimedCatalogIndex;
      slot.timedRotationCycle = 0;
      slot.timedRotationPosition = 0;
      slot.timedPlaybackStartTick = 0;
      slot.timedRandomCIndex = kNoTimedCatalogIndex;
      slot.timedRandomDIndex = kNoTimedCatalogIndex;
      slot.timedRotationActive = false;
      slot.timedPreludeCompleted = false;
      slot.timedBridgeCompleted = false;
      BumpSpotifyTargetGeneration(slot);
      SetSlotState(slot, slot.webview
          ? SlotState::WaitingTarget
          : SlotState::NotCreated);
    }
  }

  // TVer leaves the current completion-driven rotation untouched. If a network
  // rebuild removed that state, RunStaggeredReconcile() restores rotation on the
  // normal serialized turns instead of waiting through another 20-minute prelude.
  RecomputeForeground();
  RunStaggeredReconcile();
  ArmRobustScheduler();
}
