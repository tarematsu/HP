namespace {
constexpr ULONGLONG kSpotifyTimedSlotOffsetMs = 40ULL * 1000ULL;
constexpr ULONGLONG kSpotifyTimedTalkAboutStartMs = 4ULL * 60ULL * 1000ULL;
constexpr ULONGLONG kSpotifyTimedRotationStartMs = 20ULL * 60ULL * 1000ULL;
constexpr ULONGLONG kSpotifyAuthenticationHoldMs = 3ULL * 60ULL * 1000ULL;
}  // namespace

void CALLBACK SpotifyWebViews::StaggeredReconcileTimerProc(
    HWND hwnd, UINT, UINT_PTR timerId, DWORD) {
  if (timerId != kSpotifyRobustReconcileTimer || !hwnd || !IsWindow(hwnd)) {
    return;
  }
  auto* slot = reinterpret_cast<Slot*>(GetWindowLongPtrW(hwnd, GWLP_USERDATA));
  if (!slot || !slot->owner || slot->index != 0) return;
  slot->owner->StopLegacySchedulers();
  slot->owner->RunStaggeredReconcile();
}

void SpotifyWebViews::RunStaggeredReconcile() noexcept {
  if (!started_ || slots_.empty()) return;

  const ULONGLONG now = GetTickCount64();
  if (youtubeCycleStartTick_ == 0) youtubeCycleStartTick_ = now;
  if (staggerSlotStartTick_ == 0) staggerSlotStartTick_ = now;

  // The three-minute value is now a failure watchdog, not a song-length cap.
  // Healthy songs may run for their full duration. A slot advances only after
  // its end observer confirms the next real track, or after it has remained
  // unhealthy / stuck in a post-track/ad waiting state for three minutes.
  for (Slot& candidate : slots_) {
    if (!candidate.timedRotationActive) continue;

    bool watchdogExpired = false;
    if (candidate.timedCompletionPendingTick != 0) {
      watchdogExpired =
          now - candidate.timedCompletionPendingTick >=
          kSpotifyTimedFailureWatchdogMs;
    } else if (candidate.playing) {
      candidate.timedUnhealthySinceTick = 0;
    } else if (candidate.timedUnhealthySinceTick == 0) {
      candidate.timedUnhealthySinceTick = now;
    } else {
      watchdogExpired =
          now - candidate.timedUnhealthySinceTick >=
          kSpotifyTimedFailureWatchdogMs;
    }

    if (watchdogExpired) {
      AdvanceTimedRotationSlot(candidate, now);
      break;
    }
  }

  const ULONGLONG elapsed = now - youtubeCycleStartTick_;
  const size_t scheduledIndex = static_cast<size_t>(
      (elapsed / kSpotifyTimedSlotOffsetMs) % slots_.size());

  const bool priorityActive =
      timedPrioritySlotIndex_ < slots_.size() &&
      now < timedPriorityUntilTick_;
  if (!priorityActive) {
    timedPrioritySlotIndex_ = kAccountCount;
    timedPriorityUntilTick_ = 0;
  }

  // Authentication is the only foreground Spotify state. Give an account up to
  // three minutes to finish manual login; otherwise the normal 40-second clock
  // owns the viewport, except for a just-finished song's short recovery priority.
  staggerSlotIndex_ %= slots_.size();
  const bool currentAuthentication =
      slots_[staggerSlotIndex_].webview &&
      SlotIsLoginPage(slots_[staggerSlotIndex_]);
  const bool holdAuthentication =
      currentAuthentication &&
      now - staggerSlotStartTick_ < kSpotifyAuthenticationHoldMs;

  if (!holdAuthentication && priorityActive &&
      staggerSlotIndex_ != timedPrioritySlotIndex_) {
    staggerSlotIndex_ = timedPrioritySlotIndex_;
    staggerSlotStartTick_ = now;
    staggerSlotValidated_ = false;
    RefreshSpotifyHostLayout();
  } else if (!holdAuthentication && staggerSlotIndex_ != scheduledIndex) {
    staggerSlotIndex_ = scheduledIndex;
    staggerSlotStartTick_ = now;
    staggerSlotValidated_ = false;
    RefreshSpotifyHostLayout();
  }

  Slot& slot = slots_[staggerSlotIndex_];
  if (!slot.hostWindow || !IsWindow(slot.hostWindow)) return;
  RefreshSpotifyHostLayout();

  if (slot.webview && SlotIsLoginPage(slot)) return;

  const ULONGLONG slotOffset =
      static_cast<ULONGLONG>(slot.index) * kSpotifyTimedSlotOffsetMs;
  if (elapsed < slotOffset) return;
  const ULONGLONG slotLocalElapsed = elapsed - slotOffset;

  if (slotLocalElapsed < kSpotifyTimedRotationStartMs) {
    TimedSpotifyTarget desired = TimedSpotifyTarget::LonesomeRabbit;
    if (podcastMode_ && slotLocalElapsed < kSpotifyTimedTalkAboutStartMs) {
      // YouTube 00:00 + account offset: fixed B once.
      desired = TimedSpotifyTarget::BitterBlue;
    } else if (podcastMode_ && !slot.podcastCompleted) {
      // YouTube 04:00 + account offset: one TALKABOUT pass.
      desired = TimedSpotifyTarget::TalkAbout;
    }

    const bool targetChanged = slot.timedTarget != desired;
    if (targetChanged) {
      slot.timedTarget = desired;
      slot.timedCatalogIndex = kNoTimedCatalogIndex;
      slot.lastModeNavigateTick = 0;
      slot.unhealthyChecks = 0;
      slot.timedPreludeCompleted = false;
      NavigateTimedSlot(slot);
    }

    // BitterBlue is a one-shot prelude. Once its end observer has seen it finish,
    // leave Spotify alone until the 04:00 TALKABOUT boundary instead of replaying.
    if (slot.timedTarget == TimedSpotifyTarget::BitterBlue &&
        slot.timedPreludeCompleted) {
      return;
    }

    ReconcileTimedSlot(slot);
    return;
  }

  if (!slot.timedRotationActive) {
    // 20:00 + account offset starts A. From here on, actual playback completion
    // drives B/C/D/A rather than wall-clock three-minute boundaries.
    InitializeTimedRotationSlot(slot, now);
  }

  ArmTimedEndObserver(slot);

  // An ended media element may be followed by a Spotify ad. The observer marks
  // this waiting state but deliberately does not navigate until another real
  // /track/ appears. Skip recovery clicks here so the ad is not interrupted.
  if (slot.timedCompletionPendingTick != 0) return;

  ReconcileTimedSlot(slot);
}

void SpotifyWebViews::SetPodcastMode(bool podcastWindowActive) noexcept {
  if (!started_ || slots_.empty()) return;

  StopLegacySchedulers();
  const ULONGLONG now = GetTickCount64();
  if (!robustSchedulerStarted_) {
    robustSchedulerStarted_ = true;
    reconcileIndex_ = 0;
    staggerSlotIndex_ = 0;
    staggerSlotStartTick_ = now;
    youtubeCycleStartTick_ = now;
    staggerSlotValidated_ = false;

    // Start() already requested slot 0. The remaining controllers are created
    // only when their 40-second offsets become active, keeping heavy loads apart.
    Slot& first = slots_[0];
    if (!first.controller && !first.webview) {
      first.controllerCreating = true;
      first.controllerCreateTick = now;
    }
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
    // A new YouTube hour is the master clock. B starts at 00:00, TALKABOUT at
    // 04:00, and A starts at 20:00. After that, each real song ending advances
    // A -> B -> C -> D -> A; C/D are redrawn on each completed four-song cycle.
    youtubeCycleStartTick_ = now;
    staggerSlotIndex_ = 0;
    staggerSlotStartTick_ = now;
    staggerSlotValidated_ = false;
    timedPrioritySlotIndex_ = kAccountCount;
    timedPriorityUntilTick_ = 0;
    timedRandomPairCycle_ = ~0ULL;
    timedRandomCIndex_ = kNoTimedCatalogIndex;
    timedRandomDIndex_ = kNoTimedCatalogIndex;
    for (Slot& slot : slots_) {
      slot.lastModeNavigateTick = 0;
      slot.unhealthyChecks = 0;
      slot.podcastCompleted = false;
      slot.timedTarget = TimedSpotifyTarget::None;
      slot.timedCatalogIndex = kNoTimedCatalogIndex;
      slot.lastTimedRotationWave = ~0ULL;
      slot.timedRotationCycle = 0;
      slot.timedRotationPosition = 0;
      slot.timedStepStartTick = 0;
      slot.timedCompletionPendingTick = 0;
      slot.timedUnhealthySinceTick = 0;
      slot.timedRandomCIndex = kNoTimedCatalogIndex;
      slot.timedRandomDIndex = kNoTimedCatalogIndex;
      slot.timedRotationActive = false;
      slot.timedPreludeCompleted = false;
    }
  }

  // TVer does not reset the YouTube master clock. Any A-B-C-D sequence already
  // running continues to advance from actual song endings through the TVer hour.
  RecomputeForeground();
  RunStaggeredReconcile();
}