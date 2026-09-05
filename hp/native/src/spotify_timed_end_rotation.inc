namespace {
constexpr ULONGLONG kSpotifyTimedFailureWatchdogMs = 3ULL * 60ULL * 1000ULL;
constexpr ULONGLONG kSpotifyTimedPriorityHoldMs = 40ULL * 1000ULL;

std::wstring BuildSpotifyTimedEndObserverScript(
    std::wstring_view targetPath, std::wstring_view targetTitle) {
  std::wstring script = LR"JS(
(() => {
  const targetPath = ')JS";
  script.append(targetPath);
  script += LR"JS(';
  const targetTitle = ')JS";
  script.append(targetTitle);
  script += LR"JS('.toLowerCase();
  const key = targetPath || ('title:' + targetTitle);
  const previous = window.__homePanelTimedEndObserver;
  if (previous && previous.key === key && previous.check) {
    previous.check();
    return true;
  }
  if (previous && previous.timer) clearInterval(previous.timer);

  const post = message => {
    try {
      if (window.chrome && window.chrome.webview) {
        window.chrome.webview.postMessage(message);
      }
    } catch (_) {}
  };
  const normalize = value => (value || '').replace(/\s+/g, ' ').trim();
  const currentTrack = () => {
    const selectors = [
      '[data-testid="now-playing-widget"] a[href*="/track/"]',
      '[data-testid="context-item-link"][href*="/track/"]'
    ];
    for (const selector of selectors) {
      const link = document.querySelector(selector);
      if (!link) continue;
      try {
        const path = new URL(link.href, location.href).pathname;
        if (!path.startsWith('/track/')) continue;
        return {
          path,
          title: normalize(link.textContent).toLowerCase()
        };
      } catch (_) {}
    }
    return { path: '', title: '' };
  };
  const matchesTarget = track => targetPath
      ? track.path === targetPath
      : !!track.path && track.title === targetTitle;

  const state = {
    key,
    started: false,
    targetTrackPath: '',
    waitingPosted: false,
    endedPosted: false,
    media: new WeakSet(),
    timer: 0,
    check: null
  };
  const bindMedia = () => {
    document.querySelectorAll('audio, video').forEach(media => {
      if (state.media.has(media)) return;
      state.media.add(media);
      media.addEventListener('ended', () => {
        if (!state.started || state.endedPosted || state.waitingPosted) return;
        state.waitingPosted = true;
        post('spotify:timed-waiting');
      }, { passive: true });
    });
  };
  state.check = () => {
    bindMedia();
    const track = currentTrack();
    if (matchesTarget(track)) {
      state.started = true;
      if (track.path) state.targetTrackPath = track.path;
      return;
    }
    if (!state.started || state.endedPosted) return;

    // Ads do not expose another /track/ context. Wait through them, then advance
    // only after Spotify exposes the next real track. This avoids fighting ads.
    if (track.path &&
        (!state.targetTrackPath || track.path !== state.targetTrackPath)) {
      state.endedPosted = true;
      post('spotify:timed-ended');
    }
  };
  state.timer = setInterval(state.check, 750);
  window.__homePanelTimedEndObserver = state;
  state.check();
  return true;
})()
)JS";
  return script;
}
}  // namespace

void SpotifyWebViews::ApplyTimedRotationTarget(Slot& slot) noexcept {
  slot.timedCatalogIndex = kNoTimedCatalogIndex;
  switch (slot.timedRotationPosition % 4U) {
    case 0:
      slot.timedTarget = TimedSpotifyTarget::LonesomeRabbit;
      break;
    case 1:
      slot.timedTarget = TimedSpotifyTarget::BitterBlue;
      break;
    case 2:
      slot.timedTarget = TimedSpotifyTarget::CatalogTrack;
      slot.timedCatalogIndex = slot.timedRandomCIndex;
      break;
    default:
      slot.timedTarget = TimedSpotifyTarget::CatalogTrack;
      slot.timedCatalogIndex = slot.timedRandomDIndex;
      break;
  }
  slot.playing = false;
  slot.unhealthyChecks = 0;
  slot.lastModeNavigateTick = 0;
  slot.timedCompletionPendingTick = 0;
  slot.timedUnhealthySinceTick = 0;
  slot.timedPreludeCompleted = false;
}

void SpotifyWebViews::InitializeTimedRotationSlot(
    Slot& slot, ULONGLONG now) noexcept {
  slot.timedRotationActive = true;
  slot.timedRotationPosition = 0;
  slot.timedRotationCycle = 0;
  EnsureTimedRandomPair(slot.timedRotationCycle);
  slot.timedRandomCIndex = timedRandomCIndex_;
  slot.timedRandomDIndex = timedRandomDIndex_;
  slot.timedStepStartTick = now;
  ApplyTimedRotationTarget(slot);
  timedPrioritySlotIndex_ = slot.index;
  timedPriorityUntilTick_ = now + kSpotifyTimedPriorityHoldMs;
  NavigateTimedSlot(slot);
}

void SpotifyWebViews::AdvanceTimedRotationSlot(
    Slot& slot, ULONGLONG now) noexcept {
  if (!slot.timedRotationActive) return;
  slot.timedRotationPosition =
      static_cast<unsigned char>((slot.timedRotationPosition + 1U) % 4U);
  if (slot.timedRotationPosition == 0U) {
    ++slot.timedRotationCycle;
    EnsureTimedRandomPair(slot.timedRotationCycle);
    slot.timedRandomCIndex = timedRandomCIndex_;
    slot.timedRandomDIndex = timedRandomDIndex_;
  }
  slot.timedStepStartTick = now;
  ApplyTimedRotationTarget(slot);
  timedPrioritySlotIndex_ = slot.index;
  timedPriorityUntilTick_ = now + kSpotifyTimedPriorityHoldMs;
  staggerSlotIndex_ = slot.index;
  staggerSlotStartTick_ = now;
  staggerSlotValidated_ = false;
  RefreshSpotifyHostLayout();
  NavigateTimedSlot(slot);
}

void SpotifyWebViews::ArmTimedEndObserver(Slot& slot) noexcept {
  if (!slot.webview || !slot.timedRotationActive ||
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
              const bool waiting =
                  wcscmp(rawMessage, L"spotify:timed-waiting") == 0;
              const bool ended =
                  wcscmp(rawMessage, L"spotify:timed-ended") == 0;
              CoTaskMemFree(rawMessage);
              if (!waiting && !ended) return S_OK;

              const ULONGLONG now = GetTickCount64();
              if (!target->timedRotationActive) {
                if (target->timedTarget == TimedSpotifyTarget::BitterBlue) {
                  target->timedPreludeCompleted = true;
                  target->playing = true;
                  target->unhealthyChecks = 0;
                  RecomputeForeground();
                }
                return S_OK;
              }

              if (waiting) {
                if (target->timedCompletionPendingTick == 0) {
                  target->timedCompletionPendingTick = now;
                }
                target->playing = true;
                target->unhealthyChecks = 0;
                target->timedUnhealthySinceTick = 0;
                RecomputeForeground();
                return S_OK;
              }

              target->timedCompletionPendingTick = 0;
              AdvanceTimedRotationSlot(*target, now);
              return S_OK;
            }).Get(),
        &token);
    if (SUCCEEDED(added)) {
      slot.timedEndMessageReceivedToken = token;
      slot.timedEndHandlerWebview = slot.webview.Get();
    }
  }

  std::wstring_view targetPath;
  std::wstring_view targetTitle;
  switch (slot.timedTarget) {
    case TimedSpotifyTarget::BitterBlue:
      targetPath = kSpotifyBitterBluePath;
      break;
    case TimedSpotifyTarget::LonesomeRabbit:
      targetTitle = L"lonesome rabbit";
      break;
    case TimedSpotifyTarget::CatalogTrack: {
      const SpotifyTimedCatalogTrack* track =
          TimedCatalogTrack(slot.timedCatalogIndex);
      if (!track) return;
      targetPath = track->path;
      break;
    }
    case TimedSpotifyTarget::TalkAbout:
    case TimedSpotifyTarget::None:
      return;
  }

  const std::wstring script =
      BuildSpotifyTimedEndObserverScript(targetPath, targetTitle);
  slot.webview->ExecuteScript(script.c_str(), nullptr);
}
