// SlotState is the queue. Each scheduler pass scans once from the previous slot
// and starts at most one piece of WebView work. The adaptive timer wakes only
// for startup, recovery, async timeout, completion deadline, audio health, or
// the coarse healthy audit.

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
  gSpotifyAudioHealthCheckDueTicks.fill(0);
  gSpotifyAudioHealthSilenceConfirmTicks.fill(0);
  gSpotifyHeavyRecoveryNextTick = 0;
  for (Slot& slot : slots_) {
    ResetMediaRecoveryEpisode(slot.recoveryEpisode, slot.targetGeneration);
    slot.profileRecoveryPending = false;
    slot.profileRecoveryInFlight = false;
    slot.profileRecoveryDeep = false;
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

  const auto reloadMediaSurface = [this, now](Slot& slot) noexcept {
    slot.mediaKeyWaitUntilTick = 0;
    slot.mediaNetworkRecoveryTick = 0;
    slot.mediaKeyWaitFailurePending = false;
    slot.mediaNetworkRecoveryPending = false;
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

  // Profile repair is an explicit action in the same MediaRecoveryEpisode, not
  // a second recovery ladder. Preserve cookies/localStorage/credentials while
  // progressively clearing only playback-related state.
  for (const Slot& slot : slots_) {
    if (slot.profileRecoveryInFlight) return;
  }
  for (Slot& slot : slots_) {
    if (!slot.profileRecoveryPending) continue;

    const auto fallBackToSurfaceRebuild = [this, &slot, now]() noexcept {
      slot.profileRecoveryPending = false;
      slot.profileRecoveryInFlight = false;
      slot.profileRecoveryDeep = false;
      slot.mediaPipelineRecoveryGeneration = slot.targetGeneration;
      slot.mediaPipelineRecoveryPending = true;
      SetSlotState(slot, SlotState::Recovering);
      slot.nextRecoveryTick = now;
      ArmRobustScheduler();
    };

    if (!slot.webview) {
      fallBackToSurfaceRebuild();
      return;
    }

    ComPtr<ICoreWebView2_13> webview13;
    ComPtr<ICoreWebView2Profile> profile;
    ComPtr<ICoreWebView2Profile2> profile2;
    if (FAILED(slot.webview.As(&webview13)) || !webview13 ||
        FAILED(webview13->get_Profile(&profile)) || !profile ||
        FAILED(profile.As(&profile2)) || !profile2) {
      fallBackToSurfaceRebuild();
      return;
    }

    int kindsValue =
        COREWEBVIEW2_BROWSING_DATA_KINDS_SERVICE_WORKERS |
        COREWEBVIEW2_BROWSING_DATA_KINDS_CACHE_STORAGE |
        COREWEBVIEW2_BROWSING_DATA_KINDS_DISK_CACHE;
    if (slot.profileRecoveryDeep) {
      kindsValue |= COREWEBVIEW2_BROWSING_DATA_KINDS_INDEXED_DB;
    }
    const auto kinds =
        static_cast<COREWEBVIEW2_BROWSING_DATA_KINDS>(kindsValue);

    slot.profileRecoveryInFlight = true;
    const auto alive = alive_;
    Slot* const target = &slot;
    ComPtr<ICoreWebView2> expectedWebview = slot.webview;
    const HRESULT started = profile2->ClearBrowsingData(
        kinds,
        Callback<ICoreWebView2ClearBrowsingDataCompletedHandler>(
            [this, alive, target, expectedWebview](HRESULT result) -> HRESULT {
              if (!alive || !alive->load(std::memory_order_acquire)) return S_OK;
              target->profileRecoveryInFlight = false;
              if (target->webview.Get() != expectedWebview.Get()) {
                target->profileRecoveryPending = false;
                target->profileRecoveryDeep = false;
                ArmRobustScheduler();
                return S_OK;
              }
              if (FAILED(result)) {
                target->profileRecoveryPending = false;
                target->profileRecoveryDeep = false;
                target->mediaPipelineRecoveryGeneration =
                    target->targetGeneration;
                target->mediaPipelineRecoveryPending = true;
                SetSlotState(*target, SlotState::Recovering);
                target->nextRecoveryTick = GetTickCount64();
                ArmRobustScheduler();
                return S_OK;
              }

              target->profileRecoveryPending = false;
              target->profileRecoveryDeep = false;
              target->mediaPipelineRecoveryGeneration = target->targetGeneration;
              target->mediaPipelineRecoveryPending = true;
              SetSlotState(*target, SlotState::Recovering);
              target->nextRecoveryTick = GetTickCount64() + 1'000ULL;
              ArmRobustScheduler();
              return S_OK;
            }).Get());
    if (FAILED(started)) {
      fallBackToSurfaceRebuild();
    }
    return;
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
    RebuildPlaybackSurface(slot);
    return;
  }

  ProbeDueTimedCompletions(now);

  // Events remain the fast path, but each live Spotify WebView also gets one
  // native audio probe per minute. Runtime lanes B/C/D occupy the 15/30/45s
  // phases of the shared Stationhead+Spotify scan clock. A single silent native
  // sample can occur at a track boundary, so require one confirmation sample
  // before entering the unified recovery path.
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
        ObserveMediaRecoveryHealthy(
            slot.recoveryEpisode, now, slot.targetGeneration);
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

        // Spotify opts into the coordinator's extended last-resort actions.
        // The normal ladder remains trusted Play -> reload -> WebView rebuild;
        // only repeated failure advances into profile repair and browser recycle.
        const MediaRecoveryAction action = NextMediaRecoveryAction(
            slot.recoveryEpisode, MediaRecoveryEvidence::TimelineStall,
            now, slot.targetGeneration, !slot.loginPage, false, true);
        if (action == MediaRecoveryAction::ReassertPlayback) {
          SetSlotState(slot, SlotState::WaitingTarget);
          slot.nextRecoveryTick = now;
        } else if (action == MediaRecoveryAction::ReloadDocument) {
          SetSlotState(slot, SlotState::Navigating);
          slot.nextRecoveryTick = now + kSpotifyRecoveryRetryMs;
          if (!slot.webview || FAILED(slot.webview->Reload())) {
            slot.mediaPipelineRecoveryGeneration = slot.targetGeneration;
            slot.mediaPipelineRecoveryPending = true;
            SetSlotState(slot, SlotState::Recovering);
            slot.nextRecoveryTick = now;
          }
        } else if (action == MediaRecoveryAction::RebuildSurface) {
          slot.mediaPipelineRecoveryGeneration = slot.targetGeneration;
          slot.mediaPipelineRecoveryPending = true;
          SetSlotState(slot, SlotState::Recovering);
          slot.nextRecoveryTick = now;
        } else if (action == MediaRecoveryAction::RepairPlaybackState ||
                   action == MediaRecoveryAction::DeepRepairPlaybackState) {
          slot.profileRecoveryPending = true;
          slot.profileRecoveryDeep =
              action == MediaRecoveryAction::DeepRepairPlaybackState;
          SetSlotState(slot, SlotState::Recovering);
          slot.nextRecoveryTick = now;
        } else if (action == MediaRecoveryAction::RecycleEnvironment) {
          const bool recycling =
              SharedWebViewEnvironment::Instance().RecycleBrowserProcess(
                  userDataFolder_, slot.webview.Get());
          if (recycling) {
            // The browser process is shared by every Spotify profile in this
            // environment, so a successful recycle invalidates every surface.
            for (Slot& affected : slots_) {
              affected.profileRecoveryPending = false;
              affected.profileRecoveryInFlight = false;
              affected.profileRecoveryDeep = false;
              affected.mediaPipelineRecoveryGeneration =
                  affected.targetGeneration;
              affected.mediaPipelineRecoveryPending = true;
              SetSlotState(affected, SlotState::Recovering);
              affected.nextRecoveryTick = now + kSpotifyRecoveryRetryMs;
              ResetMediaRecoveryEpisode(
                  affected.recoveryEpisode, affected.targetGeneration);
            }
          } else {
            // A rejected/cooling-down recycle must not disturb healthy sibling
            // windows. Rebuild only the incident owner and let a fresh bounded
            // episode decide whether a later environment recycle is warranted.
            slot.profileRecoveryPending = false;
            slot.profileRecoveryInFlight = false;
            slot.profileRecoveryDeep = false;
            slot.mediaPipelineRecoveryGeneration = slot.targetGeneration;
            slot.mediaPipelineRecoveryPending = true;
            SetSlotState(slot, SlotState::Recovering);
            slot.nextRecoveryTick = now;
            ResetMediaRecoveryEpisode(
                slot.recoveryEpisode, slot.targetGeneration);
          }
        }
        RecomputeForeground();
        ArmRobustScheduler();
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
        candidate.asyncWork != AsyncWork::None ||
        candidate.profileRecoveryInFlight) {
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