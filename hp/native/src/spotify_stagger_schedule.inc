// SlotState is the queue. Each scheduler pass scans once from the previous slot
// and starts at most one piece of WebView work. The adaptive timer wakes only
// for startup, recovery, async timeout, completion deadline, audio health, or
// the coarse healthy audit.

namespace {
constexpr ULONGLONG kSpotifyInitialStartDelayMs = 0;
constexpr ULONGLONG kSpotifyCloudReloadMinIntervalMs = 60ULL * 1000ULL;
constexpr ULONGLONG kSpotifyDeadSinkStrikeWindowMs = 2ULL * 60ULL * 1000ULL;
std::array<ULONGLONG, kSpotifyActiveAccountCount>
    gSpotifyDeadSinkFirstStrikeTicks{};
std::array<unsigned, kSpotifyActiveAccountCount>
    gSpotifyDeadSinkStrikeCounts{};
std::array<uint64_t, kSpotifyActiveAccountCount>
    gSpotifyDeadSinkStrikeGenerations{};
}

void SpotifyWebViews::StartAutonomousSchedule(ULONGLONG now) noexcept {
  if (!started_ || networkBlocked_ || slots_.empty()) return;
  if (now == 0) now = GetTickCount64();

  BeginInitialCloudPlaylistWait(now);
  nextCloudPlaylistCheckTick_ = 0;
  schedulerCursor_ = slots_.size() - 1;
  scheduleStartTick_ = now + kSpotifyInitialStartDelayMs;
  gSpotifyAudioHealthCheckDueTicks.fill(0);
  gSpotifyAudioHealthSilenceConfirmTicks.fill(0);
  gSpotifyDeadSinkFirstStrikeTicks.fill(0);
  gSpotifyDeadSinkStrikeCounts.fill(0);
  gSpotifyDeadSinkStrikeGenerations.fill(0);

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

  const auto reloadMediaSurface = [this, now](Slot& slot) noexcept {
    slot.mediaKeyWaitUntilTick = 0;
    slot.mediaNetworkRecoveryTick = 0;
    slot.mediaKeyWaitFailurePending = false;
    slot.mediaNetworkRecoveryPending = false;
    SetSlotState(slot, SlotState::Navigating);
    slot.nextRecoveryTick = now + kSpotifyRecoveryRetryMs;
    if (!slot.webview || FAILED(slot.webview->Reload())) {
      RebuildPlaybackSurface(slot);
      return;
    }
    RecomputeForeground();
    ArmRobustScheduler();
  };

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
  // preserve its account, track target and rotation position.
  for (Slot& slot : slots_) {
    if (!slot.mediaPipelineRecoveryPending) continue;
    RebuildPlaybackSurface(slot);
    return;
  }

  ProbeDueTimedCompletions(now);

  // Events remain the fast path, but each live Spotify WebView also gets one
  // native audio probe per minute. Runtime lanes B/C/D occupy the 15/30/45s
  // phases of the shared Stationhead+Spotify scan clock. A single silent native
  // sample can occur at a track boundary, so require one five-second confirm
  // sample before entering the existing trusted-click recovery path.
  Slot* audioHealthCandidate = nullptr;
  ULONGLONG earliestAudioHealthDue = 0;
  size_t audioHealthPhase = 0;
  for (Slot& slot : slots_) {
    if (slot.index >= gSpotifyAudioHealthCheckDueTicks.size()) continue;
    ULONGLONG& due = gSpotifyAudioHealthCheckDueTicks[slot.index];
    const int lane = SpotifyRuntimeLaneForAccount(slot.index);
    if (!slot.webview || lane < 0 || slot.loginPage ||
        !CurrentMusicTrack(slot) || !SlotStateIsHealthy(slot.state)) {
      due = 0;
      gSpotifyAudioHealthSilenceConfirmTicks[slot.index] = 0;
      continue;
    }

    const size_t phase = static_cast<size_t>(lane) + 1;
    if (due == 0) due = NextAudioHealthScanTick(now, phase);
    if (now < due) continue;
    if (!audioHealthCandidate || due < earliestAudioHealthDue) {
      audioHealthCandidate = &slot;
      earliestAudioHealthDue = due;
      audioHealthPhase = phase;
    }
  }

  if (audioHealthCandidate) {
    Slot& slot = *audioHealthCandidate;
    ULONGLONG& due = gSpotifyAudioHealthCheckDueTicks[slot.index];
    ULONGLONG& silenceConfirm =
        gSpotifyAudioHealthSilenceConfirmTicks[slot.index];
    if (!TryClaimAudioHealthScan(now)) {
      due = now + kSpotifyAudioHealthRetryMs;
    } else {
      ComPtr<ICoreWebView2_8> audioView;
      BOOL nativePlaying = FALSE;
      const HRESULT audioInterfaceResult = slot.webview.As(&audioView);
      const HRESULT audioStateResult =
          SUCCEEDED(audioInterfaceResult) && audioView
              ? audioView->get_IsDocumentPlayingAudio(&nativePlaying)
              : E_NOINTERFACE;
      ReleaseAudioHealthScan();

      if (FAILED(audioInterfaceResult) || !audioView ||
          FAILED(audioStateResult)) {
        due = now + kSpotifyAudioHealthRetryMs;
      } else if (nativePlaying != FALSE) {
        silenceConfirm = 0;
        due = NextAudioHealthScanTick(now, audioHealthPhase);
      } else if (silenceConfirm == 0) {
        silenceConfirm = now + kSpotifyAudioHealthSilenceConfirmMs;
        due = silenceConfirm;
      } else if (now < silenceConfirm) {
        due = silenceConfirm;
      } else {
        silenceConfirm = 0;
        due = NextAudioHealthScanTick(now, audioHealthPhase);
        slot.timedCompletionDeadlineTick = 0;
        slot.timedCompletionDeadlineGeneration = 0;
        slot.trustedClickBlockedUntilTick = 0;

        // A live shared Audio Service can leave an existing media element bound
        // to a dead sink without emitting ProcessFailed. One sustained-silence
        // incident still uses the cheap trusted-click/reload path. If the same
        // target generation goes silent again within two minutes, bypass more
        // page-level retries and rebuild that playback surface so its audio sink
        // is rebound to the shared service from a fresh controller.
        ULONGLONG& firstStrike =
            gSpotifyDeadSinkFirstStrikeTicks[slot.index];
        unsigned& strikes = gSpotifyDeadSinkStrikeCounts[slot.index];
        uint64_t& strikeGeneration =
            gSpotifyDeadSinkStrikeGenerations[slot.index];
        if (strikeGeneration != slot.targetGeneration || firstStrike == 0 ||
            now < firstStrike || now - firstStrike > kSpotifyDeadSinkStrikeWindowMs) {
          firstStrike = now;
          strikes = 1;
          strikeGeneration = slot.targetGeneration;
        } else {
          ++strikes;
        }

        if (strikes >= 2) {
          firstStrike = 0;
          strikes = 0;
          strikeGeneration = 0;
          slot.mediaPipelineRecoveryGeneration = slot.targetGeneration;
          slot.mediaPipelineRecoveryPending = true;
          SetSlotState(slot, SlotState::Recovering);
          slot.nextRecoveryTick = now;
          ArmRobustScheduler();
        } else {
          SetSlotState(slot, SlotState::WaitingTarget);
          slot.nextRecoveryTick = now;
        }
        RecomputeForeground();
      }
    }
  }

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
