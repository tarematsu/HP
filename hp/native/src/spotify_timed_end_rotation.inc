namespace hp {
namespace {

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

bool ParseSpotifyCompletionPlanEvent(
    LPCWSTR rawMessage, ULONGLONG* generation,
    ULONGLONG* remainingMs) noexcept {
  if (!rawMessage || !generation || !remainingMs) return false;
  constexpr std::wstring_view eventName = L"spotify:timed-plan";
  const std::wstring_view value(rawMessage);
  if (value.size() <= eventName.size() ||
      value.substr(0, eventName.size()) != eventName ||
      value[eventName.size()] != kSpotifyMessageSeparator) {
    return false;
  }
  const size_t generationStart = eventName.size() + 1;
  const size_t separator = value.find(kSpotifyMessageSeparator, generationStart);
  if (separator == std::wstring_view::npos || separator == generationStart ||
      separator + 1 >= value.size()) {
    return false;
  }

  const std::wstring generationText(
      value.substr(generationStart, separator - generationStart));
  const std::wstring remainingText(value.substr(separator + 1));
  wchar_t* generationEnd = nullptr;
  wchar_t* remainingEnd = nullptr;
  const unsigned long long parsedGeneration =
      wcstoull(generationText.c_str(), &generationEnd, 10);
  const unsigned long long parsedRemaining =
      wcstoull(remainingText.c_str(), &remainingEnd, 10);
  if (!generationEnd || *generationEnd != L'\0' ||
      !remainingEnd || *remainingEnd != L'\0' ||
      parsedRemaining > 24ULL * 60ULL * 60ULL * 1000ULL) {
    return false;
  }
  *generation = static_cast<ULONGLONG>(parsedGeneration);
  *remainingMs = static_cast<ULONGLONG>(parsedRemaining);
  return true;
}

}  // namespace

void SpotifyWebViews::ApplyTimedRotationTarget(Slot& slot) noexcept {
  slot.podcastBreakActive = false;
  slot.timedCatalogIndex = kNoTimedCatalogIndex;
  slot.timedCompletionDeadlineTick = 0;
  slot.timedCompletionDeadlineGeneration = 0;
  if (slot.timedCycleTracks.empty()) PrepareTimedRotationCycle(slot);
  if (slot.timedCycleTracks.empty()) {
    slot.timedTarget = TimedSpotifyTarget::None;
    slot.timedPlaybackStartTick = 0;
    return;
  }

  slot.timedRotationPosition %= slot.timedCycleTracks.size();
  const ManagedTrack& target = slot.timedCycleTracks[slot.timedRotationPosition];
  const bool talkAboutTarget =
      SpotifyPodcastTargetReady() && target.path == SpotifyPodcastPath();
  slot.podcastBreakActive = talkAboutTarget;
  slot.timedTarget = talkAboutTarget
      ? TimedSpotifyTarget::TalkAbout
      : TimedSpotifyTarget::Music;
  BumpSpotifyTargetGeneration(slot);
  slot.unhealthySinceTick = 0;
  SetSlotState(slot, SlotState::WaitingTarget);
  slot.lastModeNavigateTick = 0;
  slot.lastTimedReconcileTick = 0;
  slot.timedPlaybackStartTick = 0;
}

void SpotifyWebViews::InitializeTimedRotationSlot(
    Slot& slot, ULONGLONG now) noexcept {
  slot.timedRotationActive = true;
  slot.podcastBreakActive = false;
  slot.timedRotationPosition = 0;
  slot.timedRotationCycle = 0;
  PrepareTimedRotationCycle(slot);
  slot.timedCloudRotationRevision = cloudRotationRevision_;
  ApplyTimedRotationTarget(slot);
  staggerSlotIndex_ = slot.index;
  staggerSlotStartTick_ = now;
  staggerSlotValidated_ = false;
  RefreshSpotifyHostLayout();
  NavigateActiveTimedSlot(slot);
}

void SpotifyWebViews::CompletePodcastBreak(
    Slot& slot, ULONGLONG now) noexcept {
  if (!slot.timedRotationActive || !slot.podcastBreakActive) return;
  slot.podcastBreakActive = false;
  AdvanceTimedRotationSlot(slot, now);
}

void SpotifyWebViews::AdvanceTimedRotationSlot(
    Slot& slot, ULONGLONG now) noexcept {
  if (!slot.timedRotationActive || slot.podcastBreakActive) return;

  if (slot.timedCloudRotationRevision != cloudRotationRevision_) {
    slot.timedRotationPosition = 0;
    PrepareTimedRotationCycle(slot);
    slot.timedCloudRotationRevision = cloudRotationRevision_;
    if (slot.timedCycleTracks.empty()) return;
  } else {
    if (slot.timedCycleTracks.empty()) PrepareTimedRotationCycle(slot);
    if (slot.timedCycleTracks.empty()) return;

    ++slot.timedRotationPosition;
    if (slot.timedRotationPosition >= slot.timedCycleTracks.size()) {
      ++slot.timedRotationCycle;
      slot.timedRotationPosition = 0;
      PrepareTimedRotationCycle(slot);
      if (slot.timedCycleTracks.empty()) return;
    }
  }
  ApplyTimedRotationTarget(slot);
  staggerSlotIndex_ = slot.index;
  staggerSlotStartTick_ = now;
  staggerSlotValidated_ = false;
  RefreshSpotifyHostLayout();
  NavigateActiveTimedSlot(slot);
}

void SpotifyWebViews::ProbeDueTimedCompletions(ULONGLONG now) noexcept {
  for (Slot& slot : slots_) {
    if (slot.timedCompletionDeadlineTick == 0) continue;
    if (slot.timedCompletionDeadlineGeneration != slot.targetGeneration ||
        slot.timedTarget != TimedSpotifyTarget::Music ||
        !slot.timedRotationActive || !slot.webview) {
      slot.timedCompletionDeadlineTick = 0;
      slot.timedCompletionDeadlineGeneration = 0;
      continue;
    }
    if (slot.timedCompletionDeadlineTick > now) continue;

    std::wstring message = L"spotify:completion-probe";
    message.push_back(kSpotifyMessageSeparator);
    message.append(std::to_wstring(slot.targetGeneration));
    const HRESULT posted = slot.webview->PostWebMessageAsString(message.c_str());
    if (SUCCEEDED(posted)) {
      // The WebView either confirms completion or sends one fresh remaining-time
      // plan. Clearing first prevents a hot retry loop while that message is in
      // transit through WebView2.
      slot.timedCompletionDeadlineTick = 0;
      slot.timedCompletionDeadlineGeneration = 0;
    } else {
      // A failed cross-process post is retried by the same shared scheduler, not
      // by a new per-slot timer.
      slot.timedCompletionDeadlineTick = now + 1000ULL;
    }
  }
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
              ULONGLONG remainingMs = 0;
              const bool planned = ParseSpotifyCompletionPlanEvent(
                  rawMessage, &eventGeneration, &remainingMs);
              const bool planCleared = !planned && ParseSpotifyGenerationEvent(
                  rawMessage, L"spotify:timed-plan-clear", &eventGeneration);
              const bool started = !planned && !planCleared &&
                  ParseSpotifyGenerationEvent(
                      rawMessage, L"spotify:timed-started", &eventGeneration);
              const bool ended = !planned && !planCleared && !started &&
                  ParseSpotifyGenerationEvent(
                      rawMessage, L"spotify:timed-ended", &eventGeneration);
              const bool stopped = !planned && !planCleared && !started &&
                  !ended && ParseSpotifyGenerationEvent(
                      rawMessage, L"spotify:not-playing", &eventGeneration);
              CoTaskMemFree(rawMessage);
              if (!planned && !planCleared && !started && !ended && !stopped) {
                return S_OK;
              }

              if (eventGeneration == 0 ||
                  eventGeneration != target->targetGeneration) {
                return S_OK;
              }

              const ULONGLONG now = GetTickCount64();
              if (planned) {
                if (target->timedTarget != TimedSpotifyTarget::Music ||
                    !target->timedRotationActive) {
                  return S_OK;
                }
                const ULONGLONG untilProbe = remainingMs > kSpotifyCompletionProbeLeadMs
                    ? remainingMs - kSpotifyCompletionProbeLeadMs
                    : 0ULL;
                target->timedCompletionDeadlineTick = now + untilProbe;
                target->timedCompletionDeadlineGeneration = eventGeneration;
                ArmRobustScheduler();
                return S_OK;
              }

              if (planCleared) {
                target->timedCompletionDeadlineTick = 0;
                target->timedCompletionDeadlineGeneration = 0;
                ArmRobustScheduler();
                return S_OK;
              }

              if (started) {
                SetSlotState(*target, SlotState::Playing);
                target->timedPlaybackStartTick = now;
                target->unhealthySinceTick = 0;
                RecomputeForeground();
                ArmRobustScheduler();
                return S_OK;
              }

              target->timedCompletionDeadlineTick = 0;
              target->timedCompletionDeadlineGeneration = 0;
              target->timedPlaybackStartTick = 0;
              if (!target->timedRotationActive || target->podcastBreakActive) {
                return S_OK;
              }

              // Playback anomalies are fail-forward events. Retrying the same
              // target can revive Spotify's post-end 0s rewind and create a
              // same-song loop; the next generation is the safer recovery.
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
