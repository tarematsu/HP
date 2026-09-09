namespace hp {
namespace {

constexpr ULONGLONG kSpotifyPodcastBreakEveryCycles = 10ULL;

bool ParseSpotifyGenerationEvent(
    LPCWSTR rawMessage, std::wstring_view eventName,
    ULONGLONG* generation) noexcept {
  if (!rawMessage || !generation) return false;
  const std::wstring_view value(rawMessage);
  if (value.size() <= eventName.size() ||
      value.substr(0, eventName.size()) != eventName ||
      value[eventName.size()] != L'\x1f') {
    return false;
  }
  const std::wstring number(value.substr(eventName.size() + 1));
  if (number.empty()) return false;
  wchar_t* end = nullptr;
  const unsigned long long parsed = wcstoull(number.c_str(), &end, 10);
  if (!end || *end != L'\0') return false;
  *generation = static_cast<ULONGLONG>(parsed);
  return true;
}

}  // namespace

void SpotifyWebViews::StopTimedOneShotPlayback(Slot& slot) noexcept {
  if (!slot.webview) return;
  slot.webview->ExecuteScript(kSpotifyStaticStopPlaybackScript, nullptr);
}

void SpotifyWebViews::ApplyTimedRotationTarget(Slot& slot) noexcept {
  slot.podcastBreakActive = false;
  slot.timedCatalogIndex = kNoTimedCatalogIndex;
  const unsigned char position =
      static_cast<unsigned char>(slot.timedRotationPosition % 6U);
  if (position == 0U) {
    slot.timedTarget = TimedSpotifyTarget::LonesomeRabbit;
  } else if (position <= 4U) {
    slot.timedTarget = slot.timedMiddleOrder[static_cast<size_t>(position - 1U)];
  } else {
    slot.timedTarget = TimedSpotifyTarget::CatalogTrack;
    slot.timedCatalogIndex = slot.timedRandomFIndex;
  }
  BumpSpotifyTargetGeneration(slot);
  slot.unhealthySinceTick = 0;
  SetSlotState(slot, SlotState::WaitingTarget);
  slot.lastModeNavigateTick = 0;
  slot.lastTimedReconcileTick = 0;
  // Hard upper bound: arm the native clock before any Spotify navigation,
  // DOM lookup, MediaSession metadata, or playback observer can fail. Browser
  // signals may advance the rotation earlier, but they can never postpone this
  // four-minute deadline.
  slot.timedPlaybackStartTick = GetTickCount64();
}

void SpotifyWebViews::InitializeTimedRotationSlot(
    Slot& slot, ULONGLONG now) noexcept {
  slot.timedRotationActive = true;
  slot.podcastBreakActive = false;
  slot.timedRotationPosition = 0;
  slot.timedRotationCycle = 0;
  PrepareTimedRotationCycle(slot);
  ApplyTimedRotationTarget(slot);
  staggerSlotIndex_ = slot.index;
  staggerSlotStartTick_ = now;
  staggerSlotValidated_ = false;
  RefreshSpotifyHostLayout();
  NavigateActiveTimedSlot(slot);
}

void SpotifyWebViews::BeginPodcastBreak(
    Slot& slot, ULONGLONG now) noexcept {
  if (!slot.timedRotationActive) return;
  slot.podcastBreakActive = true;
  slot.timedTarget = TimedSpotifyTarget::TalkAbout;
  slot.timedCatalogIndex = kNoTimedCatalogIndex;
  slot.timedPlaybackStartTick = 0;
  slot.lastModeNavigateTick = 0;
  slot.lastTimedReconcileTick = 0;
  slot.unhealthySinceTick = 0;
  BumpSpotifyTargetGeneration(slot);
  SetSlotState(slot, SlotState::WaitingTarget);
  staggerSlotIndex_ = slot.index;
  staggerSlotStartTick_ = now;
  staggerSlotValidated_ = false;
  RefreshSpotifyHostLayout();
  NavigateActiveTimedSlot(slot);
}

void SpotifyWebViews::CompletePodcastBreak(
    Slot& slot, ULONGLONG now) noexcept {
  if (!slot.timedRotationActive || !slot.podcastBreakActive) return;
  StopTimedOneShotPlayback(slot);
  slot.podcastBreakActive = false;
  // timedRotationPosition is already 0 because the preceding F completion
  // closed the tenth cycle. Resume directly at A without incrementing the cycle
  // a second time.
  ApplyTimedRotationTarget(slot);
  staggerSlotIndex_ = slot.index;
  staggerSlotStartTick_ = now;
  staggerSlotValidated_ = false;
  RefreshSpotifyHostLayout();
  NavigateActiveTimedSlot(slot);
}

void SpotifyWebViews::AdvanceTimedRotationSlot(
    Slot& slot, ULONGLONG now) noexcept {
  if (!slot.timedRotationActive || slot.podcastBreakActive) return;
  slot.timedRotationPosition =
      static_cast<unsigned char>((slot.timedRotationPosition + 1U) % 6U);
  if (slot.timedRotationPosition == 0U) {
    ++slot.timedRotationCycle;
    PrepareTimedRotationCycle(slot);
    if (slot.timedRotationCycle % kSpotifyPodcastBreakEveryCycles == 0ULL) {
      BeginPodcastBreak(slot, now);
      return;
    }
  }
  ApplyTimedRotationTarget(slot);
  staggerSlotIndex_ = slot.index;
  staggerSlotStartTick_ = now;
  staggerSlotValidated_ = false;
  RefreshSpotifyHostLayout();
  NavigateActiveTimedSlot(slot);
}

bool SpotifyWebViews::AdvanceExpiredTimedRotation(ULONGLONG now) noexcept {
  // Per-slot native timestamps enforce the hard upper bound independently of
  // DOM and media events. Podcast breaks deliberately have no music deadline.
  for (Slot& slot : slots_) {
    if (!slot.timedRotationActive || slot.podcastBreakActive ||
        slot.timedPlaybackStartTick == 0 ||
        now - slot.timedPlaybackStartTick < kSpotifyMusicTrackDeadlineMs) {
      continue;
    }
    AdvanceTimedRotationSlot(slot, now);
    return true;
  }
  return false;
}

void SpotifyWebViews::ArmTimedEndObserver(Slot& slot) noexcept {
  if (!slot.webview || !slot.timedRotationActive || slot.podcastBreakActive ||
      slot.timedTarget == TimedSpotifyTarget::TalkAbout ||
      slot.timedTarget == TimedSpotifyTarget::None) {
    return;
  }

  if (slot.timedEndHandlerWebview != slot.webview.Get()) {
    Slot* const target = &slot;
    const auto alive = alive_;
    EventRegistrationToken token{};
    const HRESULT added = slot.webview->add_WebMessageReceived(
        Callback<ICoreWebView2WebMessageReceivedEventHandler>(
            [this, alive, target](ICoreWebView2*,
                                  ICoreWebView2WebMessageReceivedEventArgs* args)
                -> HRESULT {
              if (!alive->load(std::memory_order_acquire) || !args) return S_OK;
              LPWSTR rawMessage = nullptr;
              if (FAILED(args->TryGetWebMessageAsString(&rawMessage)) ||
                  !rawMessage) {
                return S_OK;
              }

              ULONGLONG eventGeneration = 0;
              const bool started = ParseSpotifyGenerationEvent(
                  rawMessage, L"spotify:timed-started", &eventGeneration);
              const bool ended = !started && ParseSpotifyGenerationEvent(
                  rawMessage, L"spotify:timed-ended", &eventGeneration);
              const bool stopped = !started && !ended &&
                  ParseSpotifyGenerationEvent(
                      rawMessage, L"spotify:not-playing", &eventGeneration);
              CoTaskMemFree(rawMessage);
              if (!started && !ended && !stopped) return S_OK;

              // Delayed WebView messages are harmless once every state-changing
              // event is tied to the generation that produced it.
              if (eventGeneration == 0 ||
                  eventGeneration != target->targetGeneration) {
                return S_OK;
              }

              const ULONGLONG now = GetTickCount64();
              if (started) {
                SetSlotState(*target, SlotState::Playing);
                target->unhealthySinceTick = 0;
                RecomputeForeground();
                ArmRobustScheduler();
                return S_OK;
              }

              if (stopped) {
                MarkSlotRecovering(*target, now);
                target->lastTimedReconcileTick = 0;
                staggerSlotIndex_ = target->index;
                staggerSlotStartTick_ = now >= 2000ULL ? now - 2000ULL : now;
                staggerSlotValidated_ = false;
                RecomputeForeground();
                ArmRobustScheduler();
                return S_OK;
              }

              target->timedPlaybackStartTick = 0;
              if (!target->timedRotationActive || target->podcastBreakActive) {
                return S_OK;
              }
              AdvanceTimedRotationSlot(*target, now);
              return S_OK;
            }).Get(),
        &token);
    if (SUCCEEDED(added)) {
      slot.timedEndMessageReceivedToken = token;
      slot.timedEndHandlerWebview = slot.webview.Get();
    }
  }

  if (slot.timedObserverReady || slot.timedObserverInstallInFlight) return;

  ++slot.timedObserverInstallGeneration;
  if (slot.timedObserverInstallGeneration == 0) {
    ++slot.timedObserverInstallGeneration;
  }
  const ULONGLONG observerInstallGeneration =
      slot.timedObserverInstallGeneration;
  slot.timedObserverInstallInFlight = true;
  slot.timedObserverInstallStartedTick = GetTickCount64();
  Slot* const observerTarget = &slot;
  ComPtr<ICoreWebView2> observerView = slot.webview;
  const auto observerAlive = alive_;
  const HRESULT installStarted = observerView->ExecuteScript(
      kSpotifyFastEndObserverScript,
      Callback<ICoreWebView2ExecuteScriptCompletedHandler>(
          [this, observerAlive, observerTarget, observerView,
           observerInstallGeneration](HRESULT result, LPCWSTR json) -> HRESULT {
            if (!observerAlive->load(std::memory_order_acquire) ||
                observerTarget->timedObserverInstallGeneration !=
                    observerInstallGeneration ||
                observerTarget->webview.Get() != observerView.Get()) {
              return S_OK;
            }
            observerTarget->timedObserverInstallInFlight = false;
            observerTarget->timedObserverInstallStartedTick = 0;
            observerTarget->timedObserverReady =
                SUCCEEDED(result) && json &&
                std::wstring_view(json) == L"true";
            if (!observerTarget->timedObserverReady) {
              MarkSlotRecovering(*observerTarget, GetTickCount64());
              ArmRobustScheduler();
            }
            return S_OK;
          }).Get());
  if (FAILED(installStarted)) {
    if (slot.timedObserverInstallGeneration == observerInstallGeneration &&
        slot.webview.Get() == observerView.Get()) {
      slot.timedObserverInstallInFlight = false;
      slot.timedObserverInstallStartedTick = 0;
    }
    MarkSlotRecovering(slot, GetTickCount64());
    ArmRobustScheduler();
  }
}

}  // namespace hp