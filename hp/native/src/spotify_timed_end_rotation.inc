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
  const size_t separator = value.find(kSpotifyMessageSeparator, generationStart);
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

bool ParseSpotifyResumedEvent(
    LPCWSTR rawMessage, ULONGLONG* generation,
    ULONGLONG* remainingMs) noexcept {
  return ParseSpotifyDurationEvent(
      rawMessage, L"spotify:timed-resumed", generation, remainingMs);
}

}  // namespace

void SpotifyWebViews::ApplyTimedRotationTarget(Slot& slot) noexcept {
  slot.timedCompletionDeadlineTick = 0;
  slot.timedCompletionDeadlineGeneration = 0;
  const bool statusWasVisible = slot.playbackConfirmed || !slot.observedTrackTitle.empty();
  slot.observedTrackTitle.clear();
  slot.playbackConfirmed = false;
  slot.playbackConfirmedAt = {};
  if (statusWasVisible) InvalidateSpotifyStatusForHost(slot.hostWindow);
  if (slot.timedCycleTracks.empty()) PrepareTimedRotationCycle(slot);
  if (slot.timedCycleTracks.empty()) {
    slot.timedRotationActive = false;
    return;
  }

  slot.timedRotationPosition %= slot.timedCycleTracks.size();
  BumpSpotifyTargetGeneration(slot);
  ++slot.asyncEpoch;
  if (slot.asyncEpoch == 0) ++slot.asyncEpoch;
  slot.asyncWork = AsyncWork::None;
  slot.asyncStartedTick = 0;
  slot.nextRecoveryTick = 0;
  slot.trustedClickBlockedUntilTick = 0;
  SetSlotState(slot, SlotState::WaitingTarget);
}

void SpotifyWebViews::InitializeTimedRotationSlot(Slot& slot) noexcept {
  slot.timedRotationActive = true;
  slot.timedRotationPosition = 0;
  // Each account keeps its WebView for the whole process lifetime. The cycle
  // counter only changes the deterministic shuffle seed for the next track set.
  PrepareTimedRotationCycle(slot);
  slot.timedCloudRotationRevision = cloudRotationRevision_;
  ApplyTimedRotationTarget(slot);
}

void SpotifyWebViews::AdvanceTimedRotationSlot(Slot& slot) noexcept {
  if (!slot.timedRotationActive) return;

  // Spotify controllers stay visible for their entire lifetime. Reassert TRUE
  // when advancing so navigation/recovery never inherits a hidden state.
  if (slot.controller) slot.controller->put_IsVisible(TRUE);

  std::wstring completedPath;
  if (const ManagedTrack* const track = CurrentMusicTrack(slot)) {
    completedPath = track->path;
  }

  if (slot.timedCloudRotationRevision != cloudRotationRevision_) {
    slot.timedRotationPosition = 0;
    PrepareTimedRotationCycle(slot);
    slot.timedCloudRotationRevision = cloudRotationRevision_;
    if (slot.timedCycleTracks.empty()) {
      slot.timedRotationActive = false;
      return;
    }

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
    if (slot.timedCycleTracks.empty()) {
      slot.timedRotationActive = false;
      return;
    }

    ++slot.timedRotationPosition;
    if (slot.timedRotationPosition >= slot.timedCycleTracks.size()) {
      ++slot.timedRotationCycle;
      slot.timedRotationPosition = 0;
      PrepareTimedRotationCycle(slot);
      if (slot.timedCycleTracks.empty()) {
        slot.timedRotationActive = false;
        return;
      }
    }
  }
  ApplyTimedRotationTarget(slot);
}

void SpotifyWebViews::ProbeDueTimedCompletions(ULONGLONG now) noexcept {
  for (Slot& slot : slots_) {
    if (slot.timedCompletionDeadlineTick == 0) continue;
    if (slot.timedCompletionDeadlineGeneration != slot.targetGeneration ||
        !CurrentMusicTrack(slot)) {
      slot.timedCompletionDeadlineTick = 0;
      slot.timedCompletionDeadlineGeneration = 0;
      continue;
    }
    if (slot.timedCompletionDeadlineTick > now) continue;

    slot.timedCompletionDeadlineTick = 0;
    slot.timedCompletionDeadlineGeneration = 0;
    AdvanceTimedRotationSlot(slot);
  }
}

void SpotifyWebViews::ArmTimedEndObserver(Slot& slot) noexcept {
  if (!slot.webview || !CurrentMusicTrack(slot)) return;

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
              const bool started = ParseSpotifyStartedEvent(
                  rawMessage, &eventGeneration, &remainingMs);
              const bool resumed = !started && ParseSpotifyResumedEvent(
                  rawMessage, &eventGeneration, &remainingMs);
              const bool interrupted = !started && !resumed &&
                  ParseSpotifyGenerationEvent(
                      rawMessage, L"spotify:timed-interrupted", &eventGeneration);
              const bool ended = !started && !resumed && !interrupted &&
                  ParseSpotifyGenerationEvent(
                      rawMessage, L"spotify:timed-ended", &eventGeneration);
              const bool drmWaiting =
                  !started && !resumed && !interrupted && !ended &&
                  ParseSpotifyGenerationEvent(
                      rawMessage, L"spotify:drm-waiting", &eventGeneration);
              const bool drmReady =
                  !started && !resumed && !interrupted && !ended &&
                  !drmWaiting && ParseSpotifyGenerationEvent(
                      rawMessage, L"spotify:drm-ready", &eventGeneration);
              const bool observerSynced =
                  !started && !resumed && !interrupted && !ended &&
                  !drmWaiting && !drmReady &&
                  ParseSpotifyGenerationEvent(
                      rawMessage, L"spotify:observer-synced", &eventGeneration);
              CoTaskMemFree(rawMessage);
              if (!started && !resumed && !interrupted && !ended &&
                  !drmWaiting && !drmReady && !observerSynced) {
                return S_OK;
              }
              if (eventGeneration == 0 ||
                  eventGeneration != target->targetGeneration) {
                return S_OK;
              }

              const ULONGLONG now = GetTickCount64();
              if (drmWaiting) {
                target->mediaKeyWaitUntilTick =
                    now + kMediaKeyWaitProtectionMs;
                target->mediaKeyWaitFailurePending = true;
                SetSlotState(*target, SlotState::Recovering);
                target->nextRecoveryTick =
                    target->mediaKeyWaitUntilTick;
                ArmRobustScheduler();
                return S_OK;
              }
              if (drmReady) {
                const bool wasWaitingForKey =
                    target->mediaKeyWaitUntilTick != 0 ||
                    target->mediaKeyWaitFailurePending;
                target->mediaKeyWaitUntilTick = 0;
                target->mediaKeyWaitFailurePending = false;
                if (wasWaitingForKey &&
                    target->state == SlotState::Recovering) {
                  SetSlotState(*target, SlotState::WaitingTarget);
                  target->nextRecoveryTick = now;
                }
                ArmRobustScheduler();
                return S_OK;
              }
              if (observerSynced) {
                target->asyncWork = AsyncWork::None;
                target->asyncStartedTick = 0;
                target->timedObserverReady = true;
                target->nextRecoveryTick = 0;
                ArmRobustScheduler();
                return S_OK;
              }

              const ManagedTrack* const currentTrack = CurrentMusicTrack(*target);
              if (!currentTrack) return S_OK;
              if (interrupted) {
                // Ads and other non-target playback must not consume the target
                // song's remaining-time deadline. Resume will install a fresh
                // deadline from the media element's actual remaining duration.
                target->timedCompletionDeadlineTick = 0;
                target->timedCompletionDeadlineGeneration = 0;
                SetSlotState(*target, SlotState::WaitingTarget);
                target->nextRecoveryTick = now + kSpotifyRecoveryRetryMs;
                RecomputeForeground();
                ArmRobustScheduler();
                return S_OK;
              }
              if (ended) {
                ShortenMusicCompletionDeadlineAtEnd(*target, now);
                return S_OK;
              }

              target->observedTrackTitle = currentTrack->title;
              target->mediaKeyWaitUntilTick = 0;
              target->mediaNetworkRecoveryTick = 0;
              target->mediaNetworkRecoveryAttempt = 0;
              target->mediaKeyWaitFailurePending = false;
              target->mediaNetworkRecoveryPending = false;
              GetLocalTime(&target->playbackConfirmedAt);
              target->playbackConfirmed = true;
              InvalidateSpotifyStatusForHost(target->hostWindow);
              SetSlotState(*target, SlotState::Playing);
              SetMusicCompletionDeadline(
                  *target, now, remainingMs, resumed);
              // The page observer is the authoritative playback confirmation.
              // Status display and timing both advance from the same event.
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

  if (slot.timedObserverReady || slot.asyncWork != AsyncWork::None) return;

  ++slot.asyncEpoch;
  if (slot.asyncEpoch == 0) ++slot.asyncEpoch;
  const ULONGLONG asyncEpoch = slot.asyncEpoch;
  const ULONGLONG observerTargetGeneration = slot.targetGeneration;
  slot.asyncWork = AsyncWork::Observer;
  slot.asyncStartedTick = GetTickCount64();
  Slot* const observerTarget = &slot;
  ComPtr<ICoreWebView2> observerView = slot.webview;
  const auto observerAlive = alive_;
  const HRESULT installStarted = observerView->ExecuteScript(
      kSpotifyFastEndObserverScript,
      Callback<ICoreWebView2ExecuteScriptCompletedHandler>(
          [this, observerAlive, observerTarget, observerView,
           asyncEpoch, observerTargetGeneration](HRESULT result, LPCWSTR json)
              -> HRESULT {
            if (!observerAlive->load(std::memory_order_acquire) ||
                observerTarget->asyncEpoch != asyncEpoch ||
                observerTarget->asyncWork != AsyncWork::Observer ||
                observerTarget->targetGeneration != observerTargetGeneration ||
                observerTarget->webview.Get() != observerView.Get()) {
              return S_OK;
            }
            const bool installed =
                SUCCEEDED(result) && json &&
                std::wstring_view(json) == L"true";
            if (!installed) {
              observerTarget->asyncWork = AsyncWork::None;
              observerTarget->asyncStartedTick = 0;
              observerTarget->timedObserverReady = false;
              MarkSlotRecovering(*observerTarget, GetTickCount64());
              ArmRobustScheduler();
              return S_OK;
            }

            std::wstring syncMessage = L"spotify:observer-sync";
            syncMessage.push_back(kSpotifyMessageSeparator);
            syncMessage.append(std::to_wstring(observerTargetGeneration));
            if (FAILED(observerView->PostWebMessageAsString(syncMessage.c_str()))) {
              observerTarget->asyncWork = AsyncWork::None;
              observerTarget->asyncStartedTick = 0;
              observerTarget->timedObserverReady = false;
              MarkSlotRecovering(*observerTarget, GetTickCount64());
              ArmRobustScheduler();
              return S_OK;
            }
            observerTarget->asyncStartedTick = GetTickCount64();
            ArmRobustScheduler();
            return S_OK;
          }).Get());
  if (FAILED(installStarted)) {
    if (slot.asyncEpoch == asyncEpoch && slot.asyncWork == AsyncWork::Observer) {
      slot.asyncWork = AsyncWork::None;
      slot.asyncStartedTick = 0;
    }
    MarkSlotRecovering(slot, GetTickCount64());
    ArmRobustScheduler();
  }
}

}  // namespace hp
