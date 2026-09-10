namespace hp {
namespace {

constexpr wchar_t kSpotifyPodcastScheduleFile[] =
    L"spotify-talkabout-schedule.txt";

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

void SpotifyWebViews::EnsurePodcastScheduleLoaded(ULONGLONG now) noexcept {
  if (podcastScheduleLoaded_) return;
  podcastScheduleLoaded_ = true;

  const ULONGLONG interval = SpotifyPodcastIntervalMs();
  const int64_t wallNow = UnixMillis();
  std::array<int64_t, kAccountCount> persisted{};
  bool complete = false;
  try {
    std::ifstream input(userDataFolder_.parent_path() /
                        kSpotifyPodcastScheduleFile);
    complete = static_cast<bool>(input);
    for (size_t i = 0; complete && i < persisted.size(); ++i) {
      complete = static_cast<bool>(input >> persisted[i]);
    }
  } catch (...) {
    complete = false;
  }

  bool dirty = !complete;
  for (size_t i = 0; i < slots_.size(); ++i) {
    Slot& slot = slots_[i];
    int64_t due = complete ? persisted[i] : 0;
    if (due <= 0) {
      due = wallNow + static_cast<int64_t>(
          static_cast<ULONGLONG>(i) * kSpotifyAccountStartOffsetMs);
      dirty = true;
    }

    // A corrupt file or backwards wall-clock adjustment must not postpone the
    // podcast beyond the cloud-configured interval (which is capped at 2h).
    const int64_t maxFuture = wallNow + static_cast<int64_t>(interval);
    if (due > maxFuture) {
      due = maxFuture;
      dirty = true;
    }

    slot.podcastDueUnixMs = due;
    const int64_t remainingWallMs = std::max<int64_t>(0, due - wallNow);
    const ULONGLONG remaining = static_cast<ULONGLONG>(std::min<int64_t>(
        remainingWallMs, static_cast<int64_t>(interval)));
    slot.podcastDueTick = now + remaining;
    slot.podcastPlaybackRecorded = false;
  }

  if (dirty) SavePodcastScheduleState();
}

void SpotifyWebViews::SavePodcastScheduleState() noexcept {
  try {
    const fs::path path =
        userDataFolder_.parent_path() / kSpotifyPodcastScheduleFile;
    std::error_code error;
    fs::create_directories(path.parent_path(), error);

    fs::path temporary = path;
    temporary += L".tmp";
    {
      std::ofstream output(temporary, std::ios::trunc);
      if (!output) return;
      for (const Slot& slot : slots_) output << slot.podcastDueUnixMs << '\n';
      output.flush();
      if (!output) return;
    }

    if (!MoveFileExW(temporary.c_str(), path.c_str(),
                     MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH)) {
      fs::remove(temporary, error);
    }
  } catch (...) {
    // Persistence failure may cause an extra replay after restart, but must
    // never block the in-memory deadline.
  }
}

bool SpotifyWebViews::StartOverduePodcastBreak(ULONGLONG now) noexcept {
  EnsurePodcastScheduleLoaded(now);

  if (lastPodcastDispatchTick_ != 0 &&
      now - lastPodcastDispatchTick_ < kSpotifyAccountStartOffsetMs) {
    return false;
  }

  for (Slot& slot : slots_) {
    if (!slot.timedRotationActive || slot.podcastBreakActive ||
        slot.podcastDueTick == 0 || now < slot.podcastDueTick ||
        !slot.webview || SlotIsLoginPage(slot)) {
      continue;
    }

    lastPodcastDispatchTick_ = now;
    BeginPodcastBreak(slot, now);
    return true;
  }
  return false;
}

void SpotifyWebViews::MarkPodcastPlaybackStarted(
    Slot& slot, ULONGLONG now) noexcept {
  if (!slot.podcastBreakActive || slot.podcastPlaybackRecorded) return;

  const ULONGLONG interval = SpotifyPodcastIntervalMs();
  slot.podcastPlaybackRecorded = true;
  slot.podcastDueTick = now + interval;
  slot.podcastDueUnixMs = UnixMillis() + static_cast<int64_t>(interval);
  SavePodcastScheduleState();
}

void SpotifyWebViews::StopTimedOneShotPlayback(Slot& slot) noexcept {
  if (!slot.webview) return;
  slot.webview->ExecuteScript(kSpotifyStaticStopPlaybackScript, nullptr);
}

void SpotifyWebViews::ApplyTimedRotationTarget(Slot& slot) noexcept {
  slot.podcastBreakActive = false;
  slot.timedCatalogIndex = kNoTimedCatalogIndex;
  if (slot.timedCycleTracks.empty()) PrepareTimedRotationCycle(slot);
  if (slot.timedCycleTracks.empty()) {
    slot.timedTarget = TimedSpotifyTarget::None;
    slot.timedPlaybackStartTick = 0;
    return;
  }
  slot.timedRotationPosition %= slot.timedCycleTracks.size();
  slot.timedTarget = TimedSpotifyTarget::Music;
  BumpSpotifyTargetGeneration(slot);
  slot.unhealthySinceTick = 0;
  SetSlotState(slot, SlotState::WaitingTarget);
  slot.lastModeNavigateTick = 0;
  slot.lastTimedReconcileTick = 0;
  // Hard upper bound starts before navigation. Browser failures therefore never
  // make one cloud-configured track occupy a slot for more than four minutes.
  slot.timedPlaybackStartTick = GetTickCount64();
}

void SpotifyWebViews::InitializeTimedRotationSlot(
    Slot& slot, ULONGLONG now) noexcept {
  slot.timedRotationActive = true;
  slot.podcastBreakActive = false;
  slot.podcastPlaybackRecorded = false;
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
  slot.podcastPlaybackRecorded = false;
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
  slot.podcastPlaybackRecorded = false;
  // A podcast deadline may interrupt any position. Build a fresh cloud-defined
  // cycle and resume from its first block/track.
  slot.timedRotationPosition = 0;
  PrepareTimedRotationCycle(slot);
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

  // A cloud-sync change never cuts the currently playing song. At its next
  // normal ended/4-minute boundary, discard the old prebuilt cycle and start
  // the newly synchronized rotation from its first configured block.
  if (slot.timedCloudRotationRevision != cloudRotationRevision_) {
    slot.timedRotationPosition = 0;
    PrepareTimedRotationCycle(slot);
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

bool SpotifyWebViews::AdvanceExpiredTimedRotation(ULONGLONG now) noexcept {
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
