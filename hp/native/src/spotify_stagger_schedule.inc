// SlotState is the queue. Each scheduler pass scans once from the previous slot
// and starts at most one piece of WebView work. The adaptive timer wakes only
// for startup, recovery, async timeout, completion deadline, or the coarse
// healthy audit. Unlike Stationhead, healthy Spotify playback is not polled.

namespace {
constexpr ULONGLONG kSpotifyInitialStartDelayMs = 0;
constexpr ULONGLONG kSpotifyCloudReloadMinIntervalMs = 60ULL * 1000ULL;
constexpr ULONGLONG kSpotifyHeavyRecoverySpacingMs = 5ULL * 1000ULL;
ULONGLONG gSpotifyHeavyRecoveryNextTick = 0;
}

void SpotifyWebViews::StartAutonomousSchedule(ULONGLONG now) noexcept {
  if (!started_ || networkBlocked_ || slots_.empty()) return;
  if (now == 0) now = GetTickCount64();

  BeginInitialCloudPlaylistWait(now);
  nextCloudPlaylistCheckTick_ = 0;
  schedulerCursor_ = slots_.size() - 1;
  scheduleStartTick_ = now + kSpotifyInitialStartDelayMs;
  gSpotifyHeavyRecoveryNextTick = 0;
  for (Slot& slot : slots_) {
    ResetMediaRecoveryEpisode(slot.recoveryEpisode, slot.targetGeneration);
  }

  RunStaggeredReconcile();
  ArmRobustScheduler();
}

void SpotifyWebViews::RunStaggeredReconcile() noexcept {
  if (!started_ || networkBlocked_ || slots_.empty()) return;

  const ULONGLONG now = GetTickCount64();
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

  // Spotify renders the login form asynchronously on slower systems. Give each
  // authentication document a short, bounded assist window instead of relying
  // on a single NavigationCompleted probe. The helper itself only acts on the
  // email-login page and uses the browser profile's remembered autofill entry.
  for (Slot& authSlot : slots_) {
    if (!SlotIsLoginPage(authSlot) || !authSlot.webview) continue;
    if (authSlot.authAssistPageEpoch != authSlot.pageEpoch) {
      authSlot.authAssistPageEpoch = authSlot.pageEpoch;
      authSlot.authAssistAttempts = 0;
      authSlot.nextAuthAssistTick = now;
    }
    if (authSlot.authAssistAttempts >= kSpotifyAuthAssistMaxAttempts) {
      authSlot.nextAuthAssistTick = 0;
      continue;
    }
    if (authSlot.nextAuthAssistTick != 0 &&
        now < authSlot.nextAuthAssistTick) {
      continue;
    }
    TrySpotifySavedEmailLogin(authSlot.webview.Get());
    ++authSlot.authAssistAttempts;
    authSlot.nextAuthAssistTick =
        authSlot.authAssistAttempts < kSpotifyAuthAssistMaxAttempts
            ? now + kSpotifyAuthAssistRetryMs
            : 0;
  }

  const auto reloadMediaSurface = [this, now](Slot& slot) noexcept {
    slot.mediaKeyWaitUntilTick = 0;
    slot.mediaNetworkRecoveryTick = 0;
    slot.mediaKeyWaitFailurePending = false;
    slot.mediaNetworkRecoveryPending = false;
    slot.nativeAudioStartChecks = 0;
    slot.nativeAudioStartVerified = false;
    slot.playbackConfirmed = false;
    slot.timedCompletionDeadlineTick = 0;
    slot.timedCompletionDeadlineGeneration = 0;
    SetSlotState(slot, SlotState::Navigating);
    slot.nextRecoveryTick = now + kSpotifyRecoveryRetryMs;
    if (!slot.webview || FAILED(slot.webview->Reload())) {
      slot.mediaPipelineRecoveryGeneration = slot.targetGeneration;
      slot.mediaPipelineRecoveryPending = true;
      SetSlotState(slot, SlotState::Recovering);
      slot.nextRecoveryTick = now;
      ArmRobustScheduler();
      return;
    }
    RecomputeForeground();
    ArmRobustScheduler();
  };

  // Explicit DRM/network/media-pipeline failures remain event driven. These are
  // independent from normal per-track startup verification and may occur after
  // a track has already been confirmed playing.
  for (Slot& slot : slots_) {
    if (slot.mediaKeyWaitUntilTick != 0 &&
        now >= slot.mediaKeyWaitUntilTick) {
      slot.mediaKeyWaitUntilTick = 0;
      if (slot.mediaKeyWaitFailurePending) {
        reloadMediaSurface(slot);
        return;
      }
      slot.mediaKeyWaitFailurePending = false;
    }
    if (!slot.mediaNetworkRecoveryPending) continue;
    if (slot.mediaKeyWaitUntilTick > now) {
      slot.mediaNetworkRecoveryTick = slot.mediaKeyWaitUntilTick;
      continue;
    }
    if (slot.mediaNetworkRecoveryTick != 0 &&
        now >= slot.mediaNetworkRecoveryTick) {
      reloadMediaSurface(slot);
      return;
    }
  }

  // Chromium reports decoder, decryptor and media-pipeline failures even when
  // the WebView is intentionally muted. Rebuild only the affected surface and
  // preserve its account, track target and rotation position. Heavy rebuilds
  // are globally spaced so renderer/Widevine/audio initialization cannot burst.
  for (Slot& slot : slots_) {
    if (!slot.mediaPipelineRecoveryPending) continue;
    if (slot.nextRecoveryTick != 0 && now < slot.nextRecoveryTick) continue;
    if (gSpotifyHeavyRecoveryNextTick != 0 &&
        now < gSpotifyHeavyRecoveryNextTick) {
      slot.nextRecoveryTick = std::max(
          slot.nextRecoveryTick, gSpotifyHeavyRecoveryNextTick);
      continue;
    }
    gSpotifyHeavyRecoveryNextTick = now + kSpotifyHeavyRecoverySpacingMs;
    slot.nativeAudioStartChecks = 0;
    slot.nativeAudioStartVerified = false;
    slot.playbackConfirmed = false;
    RebuildPlaybackSurface(slot);
    return;
  }

  // A completion deadline only belongs to verified healthy playback. Recovery,
  // navigation, DRM waits, and network backoff may outlive the old deadline; if
  // it survives into those states it can advance the queue before recovery has
  // a chance to finish. Drop it before probing due completions and let the next
  // successful start install a fresh deadline.
  for (Slot& slot : slots_) {
    if (SlotStateIsHealthy(slot.state)) continue;
    slot.timedCompletionDeadlineTick = 0;
    slot.timedCompletionDeadlineGeneration = 0;
  }

  ProbeDueTimedCompletions(now);

  // No periodic IsDocumentPlayingAudio scan here. Spotify's native audio check
  // exists only inside the per-track startup window. Mid-track recovery is
  // triggered only by explicit observer, process, DRM, network, or pipeline
  // events.
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
           slot.nativeAudioStartVerified &&
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
    const bool startupAudioVerificationPending =
        SlotStateIsHealthy(candidate.state) &&
        !candidate.nativeAudioStartVerified;
    if ((SlotStateNeedsRecovery(candidate.state) ||
         startupAudioVerificationPending) &&
        !recoveryReady(candidate)) {
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