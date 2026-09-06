namespace {
constexpr ULONGLONG kSpotifyTimedSlotOffsetMs = 40ULL * 1000ULL;
constexpr ULONGLONG kSpotifyTimedTalkAboutStartMs = 4ULL * 60ULL * 1000ULL;
constexpr ULONGLONG kSpotifyTimedRotationStartMs = 20ULL * 60ULL * 1000ULL;
constexpr ULONGLONG kSpotifyAuthenticationHoldMs = 40ULL * 1000ULL;
constexpr ULONGLONG kSpotifyInitialSerialWindowMs = 6ULL * 40ULL * 1000ULL;
constexpr ULONGLONG kSpotifySimpleSteadyTurnMs = 15ULL * 1000ULL;
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
  slot->owner->RunStaggeredReconcile();
}

void SpotifyWebViews::RunStaggeredReconcile() noexcept {
  if (!started_ || slots_.empty()) return;

  const ULONGLONG now = GetTickCount64();
  if (youtubeCycleStartTick_ == 0) youtubeCycleStartTick_ = now;
  if (staggerSlotStartTick_ == 0) staggerSlotStartTick_ = now;
  const ULONGLONG elapsed = now - youtubeCycleStartTick_;

  // One WebView owns the recovery-sized viewport at a time. The first six starts
  // keep the original 40-second offsets; afterwards the owner rotates every 15s.
  // There is no second background watchdog running against the other five slots.
  staggerSlotIndex_ %= slots_.size();
  Slot& current = slots_[staggerSlotIndex_];
  const bool currentAuthentication =
      current.webview && SlotIsLoginPage(current);
  const bool holdAuthentication =
      currentAuthentication &&
      now - staggerSlotStartTick_ < kSpotifyAuthenticationHoldMs;
  const bool holdRecovery =
      !currentAuthentication && current.timedTarget != TimedSpotifyTarget::None &&
      !current.playing &&
      now - staggerSlotStartTick_ < kSpotifySimpleRecoveryHoldMs;
  const size_t scheduledIndex = SimpleSpotifyScheduledIndex(elapsed);

  if (!holdAuthentication && !holdRecovery &&
      staggerSlotIndex_ != scheduledIndex) {
    staggerSlotIndex_ = scheduledIndex;
    staggerSlotStartTick_ = now;
    staggerSlotValidated_ = false;
    RefreshSpotifyHostLayout();
  }

  // SimpleSpotifyScheduledIndex is designed to return 0..5, but keep the bound
  // explicit here so both runtime safety and MSVC static analysis can prove the
  // std::array access is valid if the scheduling logic changes later.
  if (staggerSlotIndex_ >= slots_.size()) return;
  Slot& slot = slots_[staggerSlotIndex_];
  if (!slot.hostWindow || !IsWindow(slot.hostWindow)) return;
  RefreshSpotifyHostLayout();
  if (slot.webview && SlotIsLoginPage(slot)) return;

  const ULONGLONG slotOffset =
      static_cast<ULONGLONG>(slot.index) * kSpotifyTimedSlotOffsetMs;
  if (elapsed < slotOffset) return;
  const ULONGLONG slotLocalElapsed = elapsed - slotOffset;

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
      slot.lastModeNavigateTick = 0;
      slot.lastTimedReconcileTick = 0;
      slot.unhealthyChecks = 0;
      slot.playing = false;
      slot.timedCompletionPendingTick = 0;
      staggerSlotIndex_ = slot.index;
      staggerSlotStartTick_ = now;
      staggerSlotValidated_ = false;
      if (desired == TimedSpotifyTarget::BitterBlue) {
        slot.timedPreludeCompleted = false;
      }
      RefreshSpotifyHostLayout();
      NavigateActiveTimedSlot(slot);
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
      return;
    }
  } else if (!slot.timedRotationActive) {
    InitializeTimedRotationSlot(slot, now);
    return;
  }

  // A waiting state means an ended media item may have been an ad. Never skip a
  // formal A/B/C/D target because the machine was slow: after three minutes just
  // clear the ambiguity and retry the same target.
  if (slot.timedCompletionPendingTick != 0) {
    if (now - slot.timedCompletionPendingTick < kSpotifySimplePendingRecoveryMs) {
      return;
    }
    slot.timedCompletionPendingTick = 0;
    slot.playing = false;
    slot.lastTimedReconcileTick = 0;
    staggerSlotValidated_ = false;
  }

  // Give a newly expanded offscreen viewport two seconds to reflow before any
  // DOM query/click. This avoids racing Spotify's responsive layout on slow CPUs.
  if (!slot.playing &&
      now - staggerSlotStartTick_ < kSpotifySimpleLayoutSettleMs) {
    return;
  }

  if (!staggerSlotValidated_ &&
      slot.timedTarget != TimedSpotifyTarget::TalkAbout) {
    ArmTimedEndObserver(slot);
  }

  // Healthy slots receive one verification per ownership turn. A slot that still
  // needs recovery may retry every four seconds, but only while it owns the one
  // recovery viewport. No other Spotify WebView gets DOM work on this tick.
  if (!staggerSlotValidated_ || !slot.playing) {
    if (slot.lastTimedReconcileTick == 0 ||
        now - slot.lastTimedReconcileTick >= kSpotifySimpleRetryMs) {
      slot.lastTimedReconcileTick = now;
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

    // Slot 0 was started synchronously by Start(). The remaining slots are
    // created only when their serialized ownership turn arrives.
    for (size_t i = 1; i < slots_.size(); ++i) {
      slots_[i].controllerCreating = false;
      slots_[i].controllerCreateTick = 0;
      if (!slots_[i].webview) slots_[i].playing = true;
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
      slot.unhealthyChecks = 0;
      slot.playing = false;
      slot.podcastCompleted = false;
      slot.timedTarget = TimedSpotifyTarget::None;
      slot.timedCatalogIndex = kNoTimedCatalogIndex;
      slot.timedRotationCycle = 0;
      slot.timedRotationPosition = 0;
      slot.timedCompletionPendingTick = 0;
      slot.timedRandomCIndex = kNoTimedCatalogIndex;
      slot.timedRandomDIndex = kNoTimedCatalogIndex;
      slot.timedRotationActive = false;
      slot.timedPreludeCompleted = false;
      slot.timedBridgeCompleted = false;
    }
  }

  // TVer leaves the current completion-driven rotation untouched. The next
  // YouTube phase is the only place that resets the master clock and sequence.
  RecomputeForeground();
  RunStaggeredReconcile();
}
