namespace {
constexpr ULONGLONG kSpotifySerializedSlotHoldMs =
    10ULL * 60ULL * 1000ULL;
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
  if (staggerSlotStartTick_ == 0) staggerSlotStartTick_ = now;
  staggerSlotIndex_ %= slots_.size();
  Slot& slot = slots_[staggerSlotIndex_];
  if (!slot.hostWindow || !IsWindow(slot.hostWindow)) return;

  const bool holdElapsed =
      now - staggerSlotStartTick_ >= kSpotifySerializedSlotHoldMs;

  // A login page requires user interaction. Keep it as the only active slot for
  // its ten-minute turn, then allow the remaining accounts to make progress.
  if (slot.webview && SlotIsLoginPage(slot)) {
    if (holdElapsed) {
      staggerSlotIndex_ = (staggerSlotIndex_ + 1) % slots_.size();
      staggerSlotStartTick_ = now;
      staggerSlotValidated_ = false;
    }
    return;
  }

  // Once this slot has passed the robust Lonesome/TALKABOUT check, leave it
  // alone until its ten-minute ownership window expires. If WebView reports a
  // playback failure meanwhile, playing becomes false and recovery resumes on
  // this same slot rather than overlapping work on another account.
  if (staggerSlotValidated_ && slot.playing && !slot.reconcileInFlight) {
    if (holdElapsed) {
      staggerSlotIndex_ = (staggerSlotIndex_ + 1) % slots_.size();
      staggerSlotStartTick_ = now;
      staggerSlotValidated_ = false;
    }
    return;
  }

  if (slot.reconcileInFlight) return;
  reconcileIndex_ = staggerSlotIndex_;
  ReconcileDesiredMode();
  staggerSlotValidated_ = true;
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
    staggerSlotValidated_ = false;

    // Start() already requested slot 0. Park slots 1-5 at 1x1 until each gets
    // its own ten-minute turn so controller creation and Spotify page loading do
    // not pile up on a slow tablet.
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
  if (modeChanged) {
    // Do not clear or navigate all six WebViews at the media boundary. Slot 0
    // switches now; the other accounts retain their current playback until
    // their 10-minute offset arrives. Each account therefore gets a full hour
    // in each mode, phase-shifted by ten minutes from its neighbour.
    staggerSlotIndex_ = 0;
    staggerSlotStartTick_ = now;
    staggerSlotValidated_ = false;
    for (Slot& slot : slots_) {
      slot.lastModeNavigateTick = 0;
      slot.unhealthyChecks = 0;
      slot.podcastCompleted = !podcastWindowActive;
      if (!slot.webview && slot.index != 0) slot.playing = true;
    }
  }

  RecomputeForeground();
  RunStaggeredReconcile();
}
