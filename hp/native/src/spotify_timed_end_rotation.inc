namespace hp {
namespace {
constexpr ULONGLONG kSpotifySimplePendingRecoveryMs = 3ULL * 60ULL * 1000ULL;
constexpr ULONGLONG kSpotifyTimedTrackDeadlineMs = 4ULL * 60ULL * 1000ULL;

// Track-start detection stays event driven. It only reports when the current
// Spotify metadata/track matches the native target, so advertisement playback
// does not start the four-minute song deadline.
constexpr wchar_t kSpotifyStaticTimedStartObserverScript[] = LR"JS(
(() => {
  if (window.__homePanelSpotifyTimedStartObserverInstalled) return true;
  window.__homePanelSpotifyTimedStartObserverInstalled = true;

  const normalize = value => (value || '').replace(/\s+/g, ' ').trim().toLowerCase();
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
        return { path, title: normalize(link.textContent) };
      } catch (_) {}
    }
    return { path: '', title: '' };
  };
  const reportTargetStarted = () => {
    const target = window.__homePanelSpotifyNativeTarget;
    if (!target || target.kind !== 'music' || !target.title) return;

    // MediaSession follows the media item and is therefore the safest identity
    // while an advertisement is playing. If it is temporarily unavailable, fall
    // back to the visible /track/ identity. A few finite retries cover metadata
    // lag without restoring a permanent polling loop.
    const metadata = navigator.mediaSession && navigator.mediaSession.metadata;
    const mediaTitle = normalize(metadata && metadata.title);
    let matches = false;
    if (mediaTitle) {
      matches = mediaTitle === target.title;
    } else {
      const track = currentTrack();
      matches = target.trackPath
          ? track.path === target.trackPath
          : track.title === target.title;
    }
    if (!matches) return;

    try {
      if (window.chrome && window.chrome.webview) {
        window.chrome.webview.postMessage('spotify:timed-started');
      }
    } catch (_) {}
  };
  const scheduleStartChecks = delays => {
    delays.forEach(delay => setTimeout(reportTargetStarted, delay));
  };

  document.addEventListener('play', event => {
    if (!(event.target instanceof HTMLMediaElement)) return;
    scheduleStartChecks([250, 1000, 2500]);
  }, true);

  const alreadyPlaying = Array.from(document.querySelectorAll('audio, video'))
      .some(media => !media.paused && !media.ended);
  if (alreadyPlaying) scheduleStartChecks([0, 500, 1500]);
  return true;
})()
)JS";
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
  slot.playing = false;
  slot.unhealthyChecks = 0;
  slot.lastModeNavigateTick = 0;
  slot.lastTimedReconcileTick = 0;
  slot.timedCompletionPendingTick = 0;
  slot.timedPlaybackStartTick = 0;
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
  // This is six native timestamp comparisons on the existing 2-second scheduler;
  // it performs no DOM query and does not reactivate the old six-window probe.
  for (Slot& slot : slots_) {
    if (!slot.timedRotationActive || slot.timedPlaybackStartTick == 0 ||
        now - slot.timedPlaybackStartTick < kSpotifyTimedTrackDeadlineMs) {
      continue;
    }
    slot.timedPlaybackStartTick = 0;
    slot.timedCompletionPendingTick = 0;
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
              const bool started =
                  wcscmp(rawMessage, L"spotify:timed-started") == 0;
              const bool waiting =
                  wcscmp(rawMessage, L"spotify:timed-waiting") == 0;
              const bool ended =
                  wcscmp(rawMessage, L"spotify:timed-ended") == 0;
              const bool stopped =
                  wcscmp(rawMessage, L"spotify:not-playing") == 0;
              CoTaskMemFree(rawMessage);
              if (!started && !waiting && !ended && !stopped) return S_OK;

              const ULONGLONG now = GetTickCount64();
              if (started) {
                if (target->timedRotationActive &&
                    target->timedPlaybackStartTick == 0) {
                  target->timedPlaybackStartTick = now;
                }
                return S_OK;
              }

              if (stopped) {
                // Pause/stall notifications are event driven. Promote only this
                // slot to the single recovery viewport; the next existing timer
                // tick can reconcile it without scanning the other five WebViews.
                target->playing = false;
                target->lastTimedReconcileTick = 0;
                target->unhealthyChecks = 0;
                staggerSlotIndex_ = target->index;
                staggerSlotStartTick_ = now >= 2000ULL ? now - 2000ULL : now;
                staggerSlotValidated_ = false;
                RecomputeForeground();
                return S_OK;
              }

              if (waiting) {
                // Legacy observer compatibility only. New sessions use the fast
                // target-media observer and do not enter this ambiguity state.
                if (target->timedCompletionPendingTick == 0) {
                  target->timedCompletionPendingTick = now;
                }
                target->playing = true;
                target->unhealthyChecks = 0;
                RecomputeForeground();
                return S_OK;
              }

              if (target->timedRotationActive &&
                  target->timedPlaybackStartTick == 0 &&
                  target->lastModeNavigateTick != 0) {
                // Ignore only an end message that can still belong to the page
                // we just navigated away from. Once the new target has reconciled
                // (lastModeNavigateTick == 0), a valid ended event remains a
                // completion fallback even if the start message was missed.
                return S_OK;
              }
              target->timedPlaybackStartTick = 0;
              target->timedCompletionPendingTick = 0;
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
                  target->playing = true;
                  target->unhealthyChecks = 0;
                  StopTimedOneShotPlayback(*target);
                  RecomputeForeground();
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

  PostSpotifyTargetDescriptorForSlot(slot);
  slot.webview->ExecuteScript(kSpotifyStaticTimedStartObserverScript, nullptr);
  // kSpotifyStaticEndObserverScript remains compiled for compatibility tests and
  // older sessions, but new sessions use the target-media observer below.
  slot.webview->ExecuteScript(kSpotifyFastEndObserverScript, nullptr);
}

}  // namespace hp
