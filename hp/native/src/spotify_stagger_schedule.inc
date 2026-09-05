namespace {
constexpr ULONGLONG kSpotifyTimedSlotOffsetMs = 40ULL * 1000ULL;
constexpr ULONGLONG kSpotifyTimedWaveMs = 4ULL * 60ULL * 1000ULL;
constexpr ULONGLONG kSpotifyTimedTalkAboutStartMs = 4ULL * 60ULL * 1000ULL;
constexpr ULONGLONG kSpotifyTimedLonesomeStartMs = 20ULL * 60ULL * 1000ULL;
constexpr ULONGLONG kSpotifyAuthenticationHoldMs = 3ULL * 60ULL * 1000ULL;

hp::SpotifyWebViews::TimedSpotifyTarget SpotifyTimedTargetFor(
    bool youtubePhase, bool talkAboutCompleted,
    ULONGLONG slotLocalElapsed) noexcept {
  using Target = hp::SpotifyWebViews::TimedSpotifyTarget;
  if (!youtubePhase) return Target::LonesomeRabbit;
  if (slotLocalElapsed < kSpotifyTimedTalkAboutStartMs) {
    return Target::BitterBlue;
  }
  if (slotLocalElapsed < kSpotifyTimedLonesomeStartMs &&
      !talkAboutCompleted) {
    return Target::TalkAbout;
  }
  return Target::LonesomeRabbit;
}
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

  const ULONGLONG elapsed = now - youtubeCycleStartTick_;
  const size_t scheduledIndex = static_cast<size_t>(
      (elapsed / kSpotifyTimedSlotOffsetMs) % slots_.size());

  // Authentication is the only foreground Spotify state. Give an account up to
  // three minutes to finish manual login; otherwise the normal 40-second clock
  // decides which account owns the recovery viewport.
  staggerSlotIndex_ %= slots_.size();
  const bool currentAuthentication =
      slots_[staggerSlotIndex_].webview &&
      SlotIsLoginPage(slots_[staggerSlotIndex_]);
  const bool holdAuthentication =
      currentAuthentication &&
      now - staggerSlotStartTick_ < kSpotifyAuthenticationHoldMs;
  if (!holdAuthentication && staggerSlotIndex_ != scheduledIndex) {
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

  const TimedSpotifyTarget desired = SpotifyTimedTargetFor(
      podcastMode_, slot.podcastCompleted, slotLocalElapsed);
  const bool targetChanged = slot.timedTarget != desired;
  if (targetChanged) {
    slot.timedTarget = desired;
    slot.lastModeNavigateTick = 0;
    slot.unhealthyChecks = 0;
  }

  // Once Lonesome rabbit is the scheduled target, force a fresh album access at
  // the start of every four-minute per-account wave. TALKABOUT that finishes
  // early returns to Lonesome immediately but waits for the 20-minute boundary
  // before joining this periodic refresh clock.
  const bool periodicLonesome =
      desired == TimedSpotifyTarget::LonesomeRabbit &&
      (!podcastMode_ || slotLocalElapsed >= kSpotifyTimedLonesomeStartMs);
  const ULONGLONG wave = slotLocalElapsed / kSpotifyTimedWaveMs;
  const bool lonesomeWaveChanged =
      periodicLonesome && slot.lastTimedLonesomeWave != wave;

  if (lonesomeWaveChanged) {
    slot.lastTimedLonesomeWave = wave;
    NavigateTimedSlot(slot);
  } else if (targetChanged) {
    NavigateTimedSlot(slot);
  }

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
    // A new YouTube hour is the master clock: each account starts BitterBlue at
    // 00:00 + index*40s, TALKABOUT at 04:00 + index*40s, and Lonesome rabbit at
    // 20:00 + index*40s. The next YouTube hour resets this sequence again.
    youtubeCycleStartTick_ = now;
    staggerSlotIndex_ = 0;
    staggerSlotStartTick_ = now;
    staggerSlotValidated_ = false;
    for (Slot& slot : slots_) {
      slot.lastModeNavigateTick = 0;
      slot.unhealthyChecks = 0;
      slot.podcastCompleted = false;
      slot.timedTarget = TimedSpotifyTarget::None;
      slot.lastTimedLonesomeWave = ~0ULL;
    }
  }

  // TVer does not reset the YouTube master clock. Since 60 minutes is divisible
  // by four, the existing Lonesome wave continues at 60:00, 64:00, ... while
  // still preserving the same 40-second separation between the six accounts.
  RecomputeForeground();
  RunStaggeredReconcile();
}
