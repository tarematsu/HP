namespace {
constexpr ULONGLONG kSpotifyTimedSlotOffsetMs = 40ULL * 1000ULL;
constexpr ULONGLONG kSpotifyTimedTalkAboutStartMs = 4ULL * 60ULL * 1000ULL;
constexpr ULONGLONG kSpotifyTimedRotationStartMs = 20ULL * 60ULL * 1000ULL;
constexpr ULONGLONG kSpotifyAuthenticationHoldMs = kSpotifyTimedSlotOffsetMs;

constexpr wchar_t kSpotifyBackgroundPlaybackProbeScript[] = LR"JS(
(() => {
  const mediaItems = Array.from(document.querySelectorAll('audio, video'));
  const activeMedia = mediaItems.find(media =>
      media && !media.paused && !media.ended && media.readyState >= 2) || null;
  const fallbackMedia = mediaItems.find(media => media && !media.ended) ||
      mediaItems[0] || null;
  const media = activeMedia || fallbackMedia;
  const control = document.querySelector(
      'button[data-testid="control-button-playpause"]');
  const label = ((control &&
      (control.getAttribute('aria-label') || control.title)) || '')
      .toLowerCase();
  const controlPlaying =
      label.includes('pause') || label.includes('一時停止');

  if (!media) return control ? (controlPlaying ? 'playing' : 'stalled') : 'unknown';

  const now = Date.now();
  const currentTime = Number.isFinite(media.currentTime)
      ? media.currentTime : Number.NaN;
  const source = media.currentSrc || media.src || '';
  const state = window.__homePanelSpotifyBackgroundProbe ||
      (window.__homePanelSpotifyBackgroundProbe = {
        source: '',
        time: Number.NaN,
        at: 0
      });
  const active = !media.paused && !media.ended && media.readyState >= 2;
  let progressing = active;
  if (active && state.source === source &&
      Number.isFinite(state.time) && Number.isFinite(currentTime) &&
      now - state.at >= 4000 && Math.abs(currentTime - state.time) < 0.25) {
    progressing = false;
  }
  state.source = source;
  state.time = currentTime;
  state.at = now;

  if (progressing) return 'playing';
  if (!active && controlPlaying && !Number.isFinite(currentTime)) return 'playing';
  return 'stalled';
})()
)JS";
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

  // Probe one active account per 2-second scheduler tick. This stays lightweight
  // (each of the six windows is sampled about every 12 seconds) and also covers
  // BitterBlue/TALKABOUT/the bridge before the formal 20:00 rotation begins.
  Slot& probe = slots_[playbackWatchdogIndex_++ % slots_.size()];
  const bool completedPrelude =
      probe.timedTarget == TimedSpotifyTarget::BitterBlue &&
      probe.timedPreludeCompleted;
  const bool completedBridge =
      probe.timedTarget == TimedSpotifyTarget::CatalogTrack &&
      IsRecentCatalogIndex(probe.timedCatalogIndex) &&
      probe.timedBridgeCompleted;
  if (probe.timedTarget != TimedSpotifyTarget::None &&
      !completedPrelude && !completedBridge && probe.webview &&
      !probe.reconcileInFlight && probe.timedCompletionPendingTick == 0 &&
      !SlotIsLoginPage(probe) &&
      (probe.lastModeNavigateTick == 0 ||
       now - probe.lastModeNavigateTick >= kSpotifyRobustNavigateRetryMs)) {
    Slot* const target = &probe;
    const TimedSpotifyTarget requestedTarget = probe.timedTarget;
    const size_t requestedCatalogIndex = probe.timedCatalogIndex;
    const auto alive = alive_;
    probe.webview->ExecuteScript(
        kSpotifyBackgroundPlaybackProbeScript,
        Callback<ICoreWebView2ExecuteScriptCompletedHandler>(
            [this, alive, target, requestedTarget, requestedCatalogIndex](
                HRESULT result, LPCWSTR json) -> HRESULT {
              if (!alive->load(std::memory_order_acquire) || FAILED(result) ||
                  !started_ || !json || requestedTarget != target->timedTarget ||
                  (requestedTarget == TimedSpotifyTarget::CatalogTrack &&
                   requestedCatalogIndex != target->timedCatalogIndex)) {
                return S_OK;
              }

              const std::wstring_view value(json);
              if (value == L"\"playing\"") {
                if (!target->playing || target->timedUnhealthySinceTick != 0) {
                  target->playing = true;
                  target->timedUnhealthySinceTick = 0;
                  RecomputeForeground();
                }
                return S_OK;
              }
              if (value != L"\"stalled\"") return S_OK;

              const ULONGLONG detectedAt = GetTickCount64();
              target->playing = false;
              if (target->timedUnhealthySinceTick == 0) {
                target->timedUnhealthySinceTick = detectedAt;
              }

              // Only one stalled account owns recovery at a time. The 40-second
              // value is a maximum hold; normal playback releases priority on the
              // next scheduler tick so another stalled account can recover sooner.
              const bool canClaimPriority =
                  timedPrioritySlotIndex_ >= slots_.size() ||
                  detectedAt >= timedPriorityUntilTick_ ||
                  timedPrioritySlotIndex_ == target->index;
              if (canClaimPriority) {
                timedPrioritySlotIndex_ = target->index;
                timedPriorityUntilTick_ =
                    detectedAt + kSpotifyTimedPriorityHoldMs;
              }
              RecomputeForeground();
              return S_OK;
            }).Get());
  }

  // The three-minute value is now a failure watchdog, not a song-length cap.
  // Healthy songs may run for their full duration. A slot advances only after
  // its end observer confirms completion, or after it has remained unhealthy /
  // stuck in an ambiguous post-track/ad waiting state for three minutes.
  for (Slot& candidate : slots_) {
    if (!candidate.timedRotationActive) continue;

    bool watchdogExpired = false;
    if (candidate.timedCompletionPendingTick != 0) {
      watchdogExpired =
          now - candidate.timedCompletionPendingTick >=
          kSpotifyTimedFailureWatchdogMs;
    } else if (candidate.playing) {
      candidate.timedUnhealthySinceTick = 0;
      if (timedPrioritySlotIndex_ == candidate.index) {
        timedPrioritySlotIndex_ = kAccountCount;
        timedPriorityUntilTick_ = 0;
      }
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

  // Authentication is the only foreground Spotify state, but it gets just one
  // normal 40-second turn. A logged-out account must not block recovery of the
  // other five accounts for minutes.
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
    TimedSpotifyTarget desired = TimedSpotifyTarget::None;
    size_t desiredCatalogIndex = kNoTimedCatalogIndex;

    if (podcastMode_ && slotLocalElapsed < kSpotifyTimedTalkAboutStartMs) {
      // YouTube 00:00 + account offset: fixed B once.
      desired = TimedSpotifyTarget::BitterBlue;
    } else if (podcastMode_ && !slot.podcastCompleted) {
      // YouTube 04:00 + account offset: one TALKABOUT pass.
      desired = TimedSpotifyTarget::TalkAbout;
    } else if (podcastMode_ && !slot.timedBridgeCompleted) {
      // TALKABOUT finished early: play one recent Sakurazaka46 song as a bridge
      // instead of falling back to Lonesome rabbit before the formal 20:00 A.
      if (!IsRecentCatalogIndex(timedBridgeCatalogIndex_)) {
        timedBridgeCatalogIndex_ = PickRecentCatalogIndex(
            kNoTimedCatalogIndex, kNoTimedCatalogIndex);
      }
      desired = TimedSpotifyTarget::CatalogTrack;
      desiredCatalogIndex = timedBridgeCatalogIndex_;
    } else {
      // B and the bridge are one-shots. Once finished, leave Spotify alone until
      // the next explicit boundary rather than replaying either song.
      return;
    }

    const bool catalogChanged =
        desired == TimedSpotifyTarget::CatalogTrack &&
        slot.timedCatalogIndex != desiredCatalogIndex;
    const bool targetChanged = slot.timedTarget != desired || catalogChanged;
    if (targetChanged) {
      slot.timedTarget = desired;
      slot.timedCatalogIndex = desiredCatalogIndex;
      slot.lastModeNavigateTick = 0;
      slot.unhealthyChecks = 0;
      if (desired == TimedSpotifyTarget::BitterBlue) {
        slot.timedPreludeCompleted = false;
      }
      NavigateActiveTimedSlot(slot);
    } else if (desired != TimedSpotifyTarget::CatalogTrack) {
      slot.timedCatalogIndex = kNoTimedCatalogIndex;
    }

    const bool recentBridge =
        slot.timedTarget == TimedSpotifyTarget::CatalogTrack &&
        IsRecentCatalogIndex(slot.timedCatalogIndex);
    if (slot.timedTarget == TimedSpotifyTarget::BitterBlue || recentBridge) {
      ArmTimedEndObserver(slot);
    }

    if ((slot.timedTarget == TimedSpotifyTarget::BitterBlue &&
         slot.timedPreludeCompleted) ||
        (recentBridge && slot.timedBridgeCompleted)) {
      return;
    }

    ReconcileActiveTimedSlot(slot);
    return;
  }

  if (!slot.timedRotationActive) {
    // 20:00 + account offset starts A. From here on, actual playback completion
    // drives B/C/D/A rather than wall-clock three-minute boundaries.
    InitializeTimedRotationSlot(slot, now);
  }

  ArmTimedEndObserver(slot);

  // Only an ambiguous ended media/ad state waits here. A confirmed target-track
  // ended event advances immediately in the observer.
  if (slot.timedCompletionPendingTick != 0) return;

  ReconcileActiveTimedSlot(slot);
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
    // 04:00, then one recent-song bridge may fill the gap. A starts at 20:00.
    // After that each real song ending advances A -> B -> C -> D -> A, with C/D
    // redrawn from the 2025-2026 pool on each completed four-song cycle.
    youtubeCycleStartTick_ = now;
    staggerSlotIndex_ = 0;
    staggerSlotStartTick_ = now;
    staggerSlotValidated_ = false;
    timedPrioritySlotIndex_ = kAccountCount;
    timedPriorityUntilTick_ = 0;
    timedRandomPairCycle_ = ~0ULL;
    timedBridgeCatalogIndex_ = kNoTimedCatalogIndex;
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
      slot.timedBridgeCompleted = false;
    }
  }

  // TVer does not reset the YouTube master clock. Any A-B-C-D sequence already
  // running continues to advance from actual song endings through the TVer hour.
  RecomputeForeground();
  RunStaggeredReconcile();
}
