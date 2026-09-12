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

ULONGLONG SpotifySystemUnixMillisecondsNow() noexcept {
  FILETIME fileTime{};
  GetSystemTimeAsFileTime(&fileTime);
  ULARGE_INTEGER ticks{};
  ticks.LowPart = fileTime.dwLowDateTime;
  ticks.HighPart = fileTime.dwHighDateTime;
  constexpr ULONGLONG kWindowsToUnixEpoch100ns = 116444736000000000ULL;
  if (ticks.QuadPart <= kWindowsToUnixEpoch100ns) return 0;
  return (ticks.QuadPart - kWindowsToUnixEpoch100ns) / 10000ULL;
}

bool ParseSpotifyCompletionPlanEvent(
    LPCWSTR rawMessage, ULONGLONG* generation,
    ULONGLONG* remainingMs, ULONGLONG* projectedEndUnixMs) noexcept {
  if (!rawMessage || !generation || !remainingMs || !projectedEndUnixMs) {
    return false;
  }
  constexpr std::wstring_view eventName = L"spotify:timed-plan";
  const std::wstring_view value(rawMessage);
  if (value.size() <= eventName.size() ||
      value.substr(0, eventName.size()) != eventName ||
      value[eventName.size()] != kSpotifyMessageSeparator) {
    return false;
  }
  const size_t generationStart = eventName.size() + 1;
  const size_t firstSeparator =
      value.find(kSpotifyMessageSeparator, generationStart);
  if (firstSeparator == std::wstring_view::npos ||
      firstSeparator == generationStart || firstSeparator + 1 >= value.size()) {
    return false;
  }
  const size_t secondSeparator =
      value.find(kSpotifyMessageSeparator, firstSeparator + 1);
  const size_t remainingEnd =
      secondSeparator == std::wstring_view::npos ? value.size() : secondSeparator;
  if (remainingEnd <= firstSeparator + 1) return false;

  const std::wstring generationText(
      value.substr(generationStart, firstSeparator - generationStart));
  const std::wstring remainingText(
      value.substr(firstSeparator + 1, remainingEnd - firstSeparator - 1));
  const std::wstring projectedEndText =
      secondSeparator == std::wstring_view::npos
          ? std::wstring{}
          : std::wstring(value.substr(secondSeparator + 1));

  wchar_t* generationEnd = nullptr;
  wchar_t* remainingEndPtr = nullptr;
  const unsigned long long parsedGeneration =
      wcstoull(generationText.c_str(), &generationEnd, 10);
  const unsigned long long parsedRemaining =
      wcstoull(remainingText.c_str(), &remainingEndPtr, 10);
  if (!generationEnd || *generationEnd != L'\0' ||
      !remainingEndPtr || *remainingEndPtr != L'\0' ||
      parsedRemaining > 24ULL * 60ULL * 60ULL * 1000ULL) {
    return false;
  }

  ULONGLONG parsedProjectedEnd = 0;
  if (!projectedEndText.empty()) {
    wchar_t* projectedEndPtr = nullptr;
    const unsigned long long parsed =
        wcstoull(projectedEndText.c_str(), &projectedEndPtr, 10);
    if (!projectedEndPtr || *projectedEndPtr != L'\0') return false;
    parsedProjectedEnd = static_cast<ULONGLONG>(parsed);
  }

  *generation = static_cast<ULONGLONG>(parsedGeneration);
  *remainingMs = static_cast<ULONGLONG>(parsedRemaining);
  *projectedEndUnixMs = parsedProjectedEnd;
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

  std::wstring completedPath;
  if (slot.timedRotationPosition < slot.timedCycleTracks.size()) {
    completedPath = slot.timedCycleTracks[slot.timedRotationPosition].path;
  }

  if (slot.timedCloudRotationRevision != cloudRotationRevision_) {
    slot.timedRotationPosition = 0;
    PrepareTimedRotationCycle(slot);
    slot.timedCloudRotationRevision = cloudRotationRevision_;
    if (slot.timedCycleTracks.empty()) return;

    // A cloud revision becomes active only at this natural completion boundary.
    // Never let the revision reset replay the track that just completed: if the
    // rebuilt cycle starts with the same path, move to the first different
    // target. This also makes repeated config refreshes fail forward instead of
    // pinning a slot to position zero forever.
    if (!completedPath.empty() &&
        slot.timedCycleTracks[slot.timedRotationPosition].path == completedPath) {
      const auto next = std::find_if(
          slot.timedCycleTracks.begin() + 1, slot.timedCycleTracks.end(),
          [&completedPath](const ManagedTrack& track) {
            return track.path != completedPath;
          });
      if (next != slot.timedCycleTracks.end()) {
        slot.timedRotationPosition = static_cast<size_t>(
            std::distance(slot.timedCycleTracks.begin(), next));
      }
    }
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
        !slot.timedRotationActive) {
      slot.timedCompletionDeadlineTick = 0;
      slot.timedCompletionDeadlineGeneration = 0;
      continue;
    }
    if (slot.timedCompletionDeadlineTick > now) continue;

    // The first valid playback plan for this generation is the authoritative
    // native completion clock. Do not ask Spotify whether it considers the
    // track ended: the Web Player can recycle the same media element back to
    // zero and begin A again before emitting a reliable terminal event.
    slot.timedCompletionDeadlineTick = 0;
    slot.timedCompletionDeadlineGeneration = 0;
    slot.timedPlaybackStartTick = 0;
    AdvanceTimedRotationSlot(slot, now);
  }
  ArmCompletionDeadlineTimer();
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
              ULONGLONG projectedEndUnixMs = 0;
              const bool planned = ParseSpotifyCompletionPlanEvent(
                  rawMessage, &eventGeneration, &remainingMs,
                  &projectedEndUnixMs);
              const bool planCleared = !planned && ParseSpotifyGenerationEvent(
                  rawMessage, L"spotify:timed-plan-clear", &eventGeneration);
              const bool started = !planned && !planCleared &&
                  ParseSpotifyGenerationEvent(
                      rawMessage, L"spotify:timed-started", &eventGeneration);
              const bool ended = !planned && !planCleared && !started &&
                  ParseSpotifyGenerationEvent(
                      rawMessage, L"spotify:timed-ended", &eventGeneration);
              const bool observerSynced =
                  !planned && !planCleared && !started && !ended &&
                  ParseSpotifyGenerationEvent(
                      rawMessage, L"spotify:observer-synced", &eventGeneration);
              CoTaskMemFree(rawMessage);
              if (!planned && !planCleared && !started && !ended &&
                  !observerSynced) {
                return S_OK;
              }

              if (eventGeneration == 0 ||
                  eventGeneration != target->targetGeneration) {
                return S_OK;
              }

              const ULONGLONG now = GetTickCount64();
              if (observerSynced) {
                target->timedObserverInstallInFlight = false;
                target->timedObserverInstallStartedTick = 0;
                target->timedObserverReady = true;
                target->lastTimedReconcileTick = 0;
                ReconcileActiveTimedSlot(*target);
                ArmRobustScheduler();
                return S_OK;
              }

              if (planned) {
                if (target->timedTarget != TimedSpotifyTarget::Music ||
                    !target->timedRotationActive) {
                  return S_OK;
                }

                ULONGLONG effectiveRemainingMs =
                    std::max<ULONGLONG>(remainingMs, 1ULL);
                if (projectedEndUnixMs != 0) {
                  const ULONGLONG wallNow = SpotifySystemUnixMillisecondsNow();
                  if (wallNow != 0) {
                    const ULONGLONG wallRemaining =
                        projectedEndUnixMs <= wallNow
                            ? 1ULL
                            : projectedEndUnixMs - wallNow;
                    // Never let transport or wall-clock skew extend the plan.
                    // The WebView-computed remaining time is the upper bound.
                    effectiveRemainingMs =
                        std::min(effectiveRemainingMs, wallRemaining);
                  }
                }

                const ULONGLONG candidateDeadline =
                    now + std::max<ULONGLONG>(effectiveRemainingMs, 1ULL);
                if (target->timedCompletionDeadlineTick == 0 ||
                    target->timedCompletionDeadlineGeneration != eventGeneration ||
                    candidateDeadline < target->timedCompletionDeadlineTick) {
                  // Arm from the first plan and only allow a later observation
                  // to move the deadline earlier. A repeat rewind to 0 reports a
                  // full new duration, so it cannot postpone A -> B.
                  target->timedCompletionDeadlineTick = candidateDeadline;
                  target->timedCompletionDeadlineGeneration = eventGeneration;
                  ArmCompletionDeadlineTimer();
                  ArmRobustScheduler();
                }
                return S_OK;
              }

              if (planCleared) {
                // Pause/seek/stall only invalidates the WebView's local estimate.
                // Once native has armed this generation, its completion clock is
                // intentionally never cleared by Spotify lifecycle events.
                return S_OK;
              }

              if (started) {
                SetSlotState(*target, SlotState::Playing);
                if (target->timedPlaybackStartTick == 0) {
                  target->timedPlaybackStartTick = now;
                }
                target->unhealthySinceTick = 0;
                RecomputeForeground();
                ArmRobustScheduler();
                return S_OK;
              }

              target->timedCompletionDeadlineTick = 0;
              target->timedCompletionDeadlineGeneration = 0;
              target->timedPlaybackStartTick = 0;
              ArmCompletionDeadlineTimer();
              if (!target->timedRotationActive || target->podcastBreakActive) {
                return S_OK;
              }

              if (ended) {
                // A real ended event may advance slightly before the native
                // deadline. Generation fencing makes the later timer harmless.
                AdvanceTimedRotationSlot(*target, now);
                ArmCompletionDeadlineTimer();
                return S_OK;
              }

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
  const ULONGLONG observerTargetGeneration = slot.targetGeneration;
  slot.timedObserverInstallInFlight = true;
  slot.timedObserverInstallStartedTick = GetTickCount64();
  Slot* const observerTarget = &slot;
  ComPtr<ICoreWebView2> observerView = slot.webview;
  const auto observerAlive = alive_;
  const HRESULT installStarted = observerView->ExecuteScript(
      kSpotifyFastEndObserverScript,
      Callback<ICoreWebView2ExecuteScriptCompletedHandler>(
          [this, observerAlive, observerTarget, observerView,
           observerInstallGeneration, observerTargetGeneration](
              HRESULT result, LPCWSTR json) -> HRESULT {
            if (!observerAlive->load(std::memory_order_acquire) ||
                observerTarget->timedObserverInstallGeneration !=
                    observerInstallGeneration ||
                observerTarget->targetGeneration != observerTargetGeneration ||
                observerTarget->webview.Get() != observerView.Get()) {
              return S_OK;
            }
            const bool installed =
                SUCCEEDED(result) && json &&
                std::wstring_view(json) == L"true";
            if (!installed) {
              observerTarget->timedObserverInstallInFlight = false;
              observerTarget->timedObserverInstallStartedTick = 0;
              observerTarget->timedObserverReady = false;
              MarkSlotRecovering(*observerTarget, GetTickCount64());
              ArmRobustScheduler();
              return S_OK;
            }

            // The page-context generation message can be emitted before this
            // observer exists. Synchronize again after installation and wait for
            // an acknowledgement from the observer itself before allowing any
            // playback reconcile. This removes the generation-0 start race.
            std::wstring syncMessage = L"spotify:observer-sync";
            syncMessage.push_back(kSpotifyMessageSeparator);
            syncMessage.append(std::to_wstring(observerTargetGeneration));
            if (FAILED(observerView->PostWebMessageAsString(syncMessage.c_str()))) {
              observerTarget->timedObserverInstallInFlight = false;
              observerTarget->timedObserverInstallStartedTick = 0;
              observerTarget->timedObserverReady = false;
              MarkSlotRecovering(*observerTarget, GetTickCount64());
              ArmRobustScheduler();
              return S_OK;
            }
            observerTarget->timedObserverReady = false;
            observerTarget->timedObserverInstallStartedTick = GetTickCount64();
            ArmRobustScheduler();
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