namespace hp {
namespace {

constexpr ULONGLONG kSpotifyTimedTrackDeadlineMs = 4ULL * 60ULL * 1000ULL;

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
  slot.timedCatalogIndex = kNoTimedCatalogIndex;
  switch (slot.timedRotationPosition % 4U) {
    case 0:
      slot.timedTarget = TimedSpotifyTarget::LonesomeRabbit;
      break;
    case 1:
      slot.timedTarget = TimedSpotifyTarget::CatalogTrack;
      slot.timedCatalogIndex = slot.timedRandomCIndex;
      break;
    case 2:
      slot.timedTarget = TimedSpotifyTarget::BitterBlue;
      break;
    default:
      slot.timedTarget = TimedSpotifyTarget::CatalogTrack;
      slot.timedCatalogIndex = slot.timedRandomDIndex;
      break;
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
  slot.timedPreludeCompleted = false;
}

void SpotifyWebViews::InitializeTimedRotationSlot(
    Slot& slot, ULONGLONG now) noexcept {
  slot.timedRotationActive = true;
  slot.timedRotationPosition = 0;
  slot.timedRotationCycle = 0;
  EnsureRecentRandomPair(slot.timedRotationCycle, timedBridgeCatalogIndex_);
  slot.timedRandomCIndex = timedRandomCIndex_;
  slot.timedRandomDIndex = timedRandomDIndex_;
  ApplyTimedRotationTarget(slot);
  staggerSlotIndex_ = slot.index;
  staggerSlotStartTick_ = now;
  staggerSlotValidated_ = false;
  RefreshSpotifyHostLayout();
  NavigateActiveTimedSlot(slot);
}

void SpotifyWebViews::AdvanceTimedRotationSlot(
    Slot& slot, ULONGLONG now) noexcept {
  if (!slot.timedRotationActive) return;
  slot.timedRotationPosition =
      static_cast<unsigned char>((slot.timedRotationPosition + 1U) % 4U);
  if (slot.timedRotationPosition == 0U) {
    ++slot.timedRotationCycle;
    EnsureRecentRandomPair(slot.timedRotationCycle, timedBridgeCatalogIndex_);
    slot.timedRandomCIndex = timedRandomCIndex_;
    slot.timedRandomDIndex = timedRandomDIndex_;
  }
  ApplyTimedRotationTarget(slot);
  staggerSlotIndex_ = slot.index;
  staggerSlotStartTick_ = now;
  staggerSlotValidated_ = false;
  RefreshSpotifyHostLayout();
  NavigateActiveTimedSlot(slot);
}

bool SpotifyWebViews::AdvanceExpiredTimedRotation(ULONGLONG now) noexcept {
  // Six native timestamps are enough to enforce the hard upper bound. DOM and
  // media events remain useful for early completion and recovery only.
  for (Slot& slot : slots_) {
    if (!slot.timedRotationActive || slot.timedPlaybackStartTick == 0 ||
        now - slot.timedPlaybackStartTick < kSpotifyTimedTrackDeadlineMs) {
      continue;
    }
    AdvanceTimedRotationSlot(slot, now);
    return true;
  }
  return false;
}

void SpotifyWebViews::ArmTimedEndObserver(Slot& slot) noexcept {
  const bool recentBridge =
      !slot.timedRotationActive &&
      slot.timedTarget == TimedSpotifyTarget::CatalogTrack &&
      IsRecentCatalogIndex(slot.timedCatalogIndex);
  if (!slot.webview ||
      slot.timedTarget == TimedSpotifyTarget::TalkAbout ||
      slot.timedTarget == TimedSpotifyTarget::None ||
      (!slot.timedRotationActive &&
       slot.timedTarget != TimedSpotifyTarget::BitterBlue && !recentBridge)) {
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
              if (!target->timedRotationActive) {
                bool completed = false;
                if (target->timedTarget == TimedSpotifyTarget::BitterBlue) {
                  target->timedPreludeCompleted = true;
                  completed = true;
                } else if (
                    target->timedTarget == TimedSpotifyTarget::CatalogTrack &&
                    IsRecentCatalogIndex(target->timedCatalogIndex)) {
                  target->timedBridgeCompleted = true;
                  completed = true;
                }
                if (completed) {
                  SetSlotState(*target, SlotState::Completed);
                  StopTimedOneShotPlayback(*target);
                  RecomputeForeground();
                  ArmRobustScheduler();
                }
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

  slot.timedObserverInstallInFlight = true;
  Slot* const observerTarget = &slot;
  ComPtr<ICoreWebView2> observerView = slot.webview;
  const auto observerAlive = alive_;
  const HRESULT installStarted = observerView->ExecuteScript(
      kSpotifyFastEndObserverScript,
      Callback<ICoreWebView2ExecuteScriptCompletedHandler>(
          [this, observerAlive, observerTarget, observerView](
              HRESULT result, LPCWSTR json) -> HRESULT {
            if (!observerAlive->load(std::memory_order_acquire) ||
                observerTarget->webview.Get() != observerView.Get()) {
              return S_OK;
            }
            observerTarget->timedObserverInstallInFlight = false;
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
    slot.timedObserverInstallInFlight = false;
    MarkSlotRecovering(slot, GetTickCount64());
    ArmRobustScheduler();
  }
}

}  // namespace hp
