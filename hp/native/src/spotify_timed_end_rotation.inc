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

bool ParseSpotifyDurationEvent(
    LPCWSTR rawMessage, std::wstring_view eventName,
    ULONGLONG* generation, ULONGLONG* durationMs) noexcept {
  if (!rawMessage || !generation || !durationMs) return false;
  const std::wstring_view value(rawMessage);
  if (value.size() <= eventName.size() ||
      value.substr(0, eventName.size()) != eventName ||
      value[eventName.size()] != kSpotifyMessageSeparator) {
    return false;
  }

  const size_t generationStart = eventName.size() + 1;
  const size_t separator =
      value.find(kSpotifyMessageSeparator, generationStart);
  if (separator == std::wstring_view::npos || separator == generationStart ||
      separator + 1 >= value.size()) {
    return false;
  }

  const std::wstring generationText(
      value.substr(generationStart, separator - generationStart));
  const std::wstring durationText(value.substr(separator + 1));
  wchar_t* generationEnd = nullptr;
  wchar_t* durationEnd = nullptr;
  const unsigned long long parsedGeneration =
      wcstoull(generationText.c_str(), &generationEnd, 10);
  const unsigned long long parsedDuration =
      wcstoull(durationText.c_str(), &durationEnd, 10);
  if (!generationEnd || *generationEnd != L'\0' ||
      !durationEnd || *durationEnd != L'\0' || parsedDuration == 0 ||
      parsedDuration > 24ULL * 60ULL * 60ULL * 1000ULL) {
    return false;
  }

  *generation = static_cast<ULONGLONG>(parsedGeneration);
  *durationMs = static_cast<ULONGLONG>(parsedDuration);
  return true;
}

bool ParseSpotifyStartedEvent(
    LPCWSTR rawMessage, ULONGLONG* generation,
    ULONGLONG* remainingMs) noexcept {
  return ParseSpotifyDurationEvent(
      rawMessage, L"spotify:timed-started", generation, remainingMs);
}

bool ParseSpotifyInterruptionEndedEvent(
    LPCWSTR rawMessage, ULONGLONG* generation,
    ULONGLONG* interruptionMs) noexcept {
  return ParseSpotifyDurationEvent(
      rawMessage, L"spotify:timed-interruption-ended",
      generation, interruptionMs);
}

}  // namespace

void SpotifyWebViews::ApplyTimedRotationTarget(Slot& slot) noexcept {
  slot.podcastBreakActive = false;
  slot.timedCatalogIndex = kNoTimedCatalogIndex;
  slot.timedCompletionDeadlineTick = 0;
  slot.timedCompletionDeadlineGeneration = 0;
  slot.timedInterruptionStartTick = 0;
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
      slot.timedInterruptionStartTick = 0;
      continue;
    }

    const ULONGLONG effectiveDeadline = SpotifyDeadlineWithInterruptionHold(
        slot.timedCompletionDeadlineTick, slot.timedInterruptionStartTick);
    if (effectiveDeadline > now) continue;

    // A provisional interruption may hold the deadline only for a bounded
    // window. If it never resolves back to the requested track, fail forward at
    // the effective deadline instead of allowing an ad/metadata state to wedge
    // the rotation forever.
    slot.timedInterruptionStartTick = 0;
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
              ULONGLONG interruptionMs = 0;
              const bool started = ParseSpotifyStartedEvent(
                  rawMessage, &eventGeneration, &remainingMs);
              const bool interruptionStarted = !started &&
                  ParseSpotifyGenerationEvent(
                      rawMessage, L"spotify:timed-interruption-started",
                      &eventGeneration);
              const bool interruptionCancelled = !started && !interruptionStarted &&
                  ParseSpotifyGenerationEvent(
                      rawMessage, L"spotify:timed-interruption-cancelled",
                      &eventGeneration);
              const bool interruptionEnded = !started && !interruptionStarted &&
                  !interruptionCancelled && ParseSpotifyInterruptionEndedEvent(
                      rawMessage, &eventGeneration, &interruptionMs);
              const bool ended = !started && !interruptionStarted &&
                  !interruptionCancelled && !interruptionEnded &&
                  ParseSpotifyGenerationEvent(
                      rawMessage, L"spotify:timed-ended", &eventGeneration);
              const bool observerSynced = !started && !interruptionStarted &&
                  !interruptionCancelled && !interruptionEnded && !ended &&
                  ParseSpotifyGenerationEvent(
                      rawMessage, L"spotify:observer-synced", &eventGeneration);
              CoTaskMemFree(rawMessage);
              if (!started && !interruptionStarted && !interruptionCancelled &&
                  !interruptionEnded && !ended && !observerSynced) {
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

              if (target->timedTarget != TimedSpotifyTarget::Music ||
                  !target->timedRotationActive) {
                return S_OK;
              }

              if (interruptionStarted) {
                if (target->timedInterruptionStartTick == 0) {
                  target->timedInterruptionStartTick = now;
                  ArmCompletionDeadlineTimer();
                }
                ArmRobustScheduler();
                return S_OK;
              }

              if (interruptionCancelled) {
                if (target->timedInterruptionStartTick != 0) {
                  target->timedInterruptionStartTick = 0;
                  ArmCompletionDeadlineTimer();
                }
                ArmRobustScheduler();
                return S_OK;
              }

              if (interruptionEnded) {
                if (target->timedInterruptionStartTick != 0) {
                  target->timedInterruptionStartTick = 0;
                  if (target->timedCompletionDeadlineTick != 0 &&
                      target->timedCompletionDeadlineGeneration == eventGeneration) {
                    const ULONGLONG extension = std::min(
                        interruptionMs, kSpotifyMaxInterruptionHoldMs);
                    const ULONGLONG maxTick =
                        (std::numeric_limits<ULONGLONG>::max)();
                    target->timedCompletionDeadlineTick =
                        target->timedCompletionDeadlineTick > maxTick - extension
                            ? maxTick
                            : target->timedCompletionDeadlineTick + extension;
                  }
                  ArmCompletionDeadlineTimer();
                }
                ArmRobustScheduler();
                return S_OK;
              }

              if (ended) {
                // End detection is advisory only. It shortens the generation's
                // existing unified deadline to now; the common deadline probe
                // remains the sole path that advances to the next target.
                ShortenMusicCompletionDeadlineAtEnd(*target, now);
                ArmRobustScheduler();
                return S_OK;
              }

              SetSlotState(*target, SlotState::Playing);
              target->unhealthySinceTick = 0;

              // Trusted Play and direct/autoplay starts both enter one deadline
              // calculator. A deadline already armed from the Play press wins,
              // so this later observer event can never postpone it.
              ArmMusicCompletionDeadlineFromStart(
                  *target, now, remainingMs);

              RecomputeForeground();
              ArmRobustScheduler();
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