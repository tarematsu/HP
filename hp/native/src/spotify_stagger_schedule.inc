namespace {
constexpr ULONGLONG kSpotifyTimedSlotOffsetMs = 40ULL * 1000ULL;
constexpr ULONGLONG kSpotifyTimedWaveMs = 4ULL * 60ULL * 1000ULL;
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

  TimedSpotifyTarget desired = TimedSpotifyTarget::LonesomeRabbit;
  size_t desiredCatalogIndex = kNoTimedCatalogIndex;
  ULONGLONG rotationWave = ~0ULL;

  if (podcastMode_ && slotLocalElapsed < kSpotifyTimedTalkAboutStartMs) {
    // YouTube 00:00 + account offset: fixed B.
    desired = TimedSpotifyTarget::BitterBlue;
  } else if (podcastMode_ &&
             slotLocalElapsed < kSpotifyTimedRotationStartMs &&
             !slot.podcastCompleted) {
    // YouTube 04:00 + account offset: one TALKABOUT pass.
    desired = TimedSpotifyTarget::TalkAbout;
  } else if (slotLocalElapsed >= kSpotifyTimedRotationStartMs) {
    // From 20:00 onward every account follows A -> B -> C -> D at four-minute
    // intervals. One C/D pair is shared by all six accounts for that 16-minute
    // cycle; accounts still access it 40 seconds apart.
    const ULONGLONG rotationElapsed =
        slotLocalElapsed - kSpotifyTimedRotationStartMs;
    rotationWave = rotationElapsed / kSpotifyTimedWaveMs;
    const unsigned position = static_cast<unsigned>(rotationWave % 4ULL);
    const ULONGLONG rotationCycle = rotationWave / 4ULL;
    EnsureTimedRandomPair(rotationCycle);

    switch (position) {
      case 0:
        desired = TimedSpotifyTarget::LonesomeRabbit;
        break;
      case 1:
        desired = TimedSpotifyTarget::BitterBlue;
        break;
      case 2:
        desired = TimedSpotifyTarget::CatalogTrack;
        desiredCatalogIndex = timedRandomCIndex_;
        break;
      default:
        desired = TimedSpotifyTarget::CatalogTrack;
        desiredCatalogIndex = timedRandomDIndex_;
        break;
    }
  }

  const bool catalogChanged =
      desired == TimedSpotifyTarget::CatalogTrack &&
      slot.timedCatalogIndex != desiredCatalogIndex;
  const bool targetChanged = slot.timedTarget != desired || catalogChanged;
  const bool rotationWaveChanged =
      rotationWave != ~0ULL && slot.lastTimedRotationWave != rotationWave;

  if (targetChanged) {
    slot.timedTarget = desired;
    slot.timedCatalogIndex = desiredCatalogIndex;
    slot.lastModeNavigateTick = 0;
    slot.unhealthyChecks = 0;
  } else if (desired != TimedSpotifyTarget::CatalogTrack) {
    slot.timedCatalogIndex = kNoTimedCatalogIndex;
  }

  // The wave number is the authority for periodic access. This forces a fresh
  // Spotify navigation exactly on each 4-minute boundary even when TALKABOUT
  // ended early and the slot was already sitting on Lonesome rabbit at 20:00.
  if (rotationWaveChanged) {
    slot.lastTimedRotationWave = rotationWave;
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
    // A new YouTube hour is the master clock. B starts at 00:00, TALKABOUT at
    // 04:00, and the A-B-C-D rotation starts at 20:00. C/D are redrawn for the
    // first 16-minute rotation and again whenever the rotation cycle advances.
    youtubeCycleStartTick_ = now;
    staggerSlotIndex_ = 0;
    staggerSlotStartTick_ = now;
    staggerSlotValidated_ = false;
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
    }
  }

  // TVer does not reset the YouTube master clock. The A-B-C-D sequence therefore
  // keeps running through the TVer hour until the next YouTube hour resets it.
  RecomputeForeground();
  RunStaggeredReconcile();
}
