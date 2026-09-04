namespace hp {
namespace {

constexpr UINT_PTR kSpotifyRobustReconcileTimer = 0x53505243;
constexpr UINT kSpotifyRobustReconcileTickMs = 2U * 1000U;
constexpr UINT kSpotifyRobustStartupStaggerMs = 1500U;
constexpr ULONGLONG kSpotifyRobustNavigateRetryMs = 20ULL * 1000ULL;
constexpr int kSpotifyRobustUnhealthyLimit = 3;

constexpr wchar_t kSpotifyClearLegacyEnsureScript[] = LR"JS(
(() => {
  window.__homePanelSpotifyEnsure = null;
  window.__homePanelSpotifyRobustMode = 'switching';
})()
)JS";

constexpr wchar_t kSpotifyRobustMusicScript[] = LR"JS(
(() => {
  const playlistPath = '/playlist/5DQCO4Hv3MbVYHgyXEfx8g';
  const mode = 'music';
  const report = playing => {
    if (window.chrome && window.chrome.webview) {
      window.chrome.webview.postMessage(
          playing ? 'spotify:playing' : 'spotify:not-playing');
    }
  };
  const visible = element => {
    if (!element || element.disabled) return false;
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' &&
           style.pointerEvents !== 'none' && rect.width > 0 && rect.height > 0;
  };
  const labelOf = element =>
      ((element && element.getAttribute('aria-label')) || '').toLowerCase();
  const buttonShowsPlaying = button => {
    const label = labelOf(button);
    return label.includes('pause') || label.includes('一時停止');
  };
  const mediaElement = () => {
    const items = Array.from(document.querySelectorAll('audio, video'));
    return items.find(item => !item.paused && !item.ended) || items[0] || null;
  };
  const playerControl = () =>
      document.querySelector('button[data-testid="control-button-playpause"]');
  const playlistPlayButton = () =>
      Array.from(document.querySelectorAll(
          'button[data-testid="play-button"]')).find(visible) || null;

  const repeatState = button => {
    if (!button) return 'unknown';
    const checked = button.getAttribute('aria-checked');
    if (checked === 'true') return 'context';
    if (checked === 'mixed') return 'one';
    if (checked === 'false') return 'off';
    const label = labelOf(button);
    if (label.includes('enable repeat one') ||
        label.includes('1曲リピートをオン') ||
        label.includes('1曲リピートを有効')) return 'context';
    if (label.includes('disable repeat') ||
        label.includes('リピートをオフ') ||
        label.includes('リピートを無効')) return 'one';
    if (label.includes('enable repeat') ||
        label.includes('リピートをオン') ||
        label.includes('リピートを有効')) return 'off';
    return 'unknown';
  };
  const ensureContextRepeat = () => {
    const repeat = document.querySelector(
        'button[data-testid="control-button-repeat"]');
    if (!visible(repeat)) return;
    const state = repeatState(repeat);
    if (state === 'context' || state === 'unknown') return;
    if (state === 'off') {
      try { repeat.click(); } catch (_) {}
      return;
    }
    try { repeat.click(); } catch (_) {}
    window.setTimeout(() => {
      const current = document.querySelector(
          'button[data-testid="control-button-repeat"]');
      if (!visible(current)) return;
      if (repeatState(current) === 'off') {
        try { current.click(); } catch (_) {}
      }
    }, 250);
  };

  if (window.__homePanelSpotifyRobustMode !== mode ||
      typeof window.__homePanelSpotifyRobustEnsure !== 'function') {
    window.__homePanelSpotifyRobustMode = mode;
    window.__homePanelSpotifyRobustState = {
      media: null,
      time: NaN,
      stalled: 0,
    };
    window.__homePanelSpotifyRobustEnsure = () => {
      if (location.hostname !== 'open.spotify.com' ||
          !location.pathname.endsWith(playlistPath)) {
        report(false);
        return false;
      }
      ensureContextRepeat();
      const state = window.__homePanelSpotifyRobustState;
      const media = mediaElement();
      const control = playerControl();
      let playing = false;

      if (media) {
        const current = Number.isFinite(media.currentTime) ? media.currentTime : NaN;
        const ready = !media.paused && !media.ended && media.readyState >= 2;
        if (ready) {
          if (media !== state.media || !Number.isFinite(state.time) ||
              !Number.isFinite(current) || Math.abs(current - state.time) >= 0.5) {
            state.stalled = 0;
          } else {
            ++state.stalled;
          }
          playing = state.stalled < 2;
        } else {
          state.stalled = 2;
        }
        state.media = media;
        state.time = current;
      } else {
        state.media = null;
        state.time = NaN;
        state.stalled = 0;
        playing = buttonShowsPlaying(control);
      }

      if (!playing && media && !media.ended) {
        try {
          const promise = media.play();
          if (promise && typeof promise.then === 'function') {
            promise.then(() => report(true)).catch(() => report(false));
            return false;
          }
        } catch (_) {
        }
      }

      if (!playing) {
        const button = visible(control) ? control : playlistPlayButton();
        if (visible(button) && !buttonShowsPlaying(button)) {
          try { button.click(); } catch (_) {}
        }
      }
      report(playing || buttonShowsPlaying(playerControl()));
      return playing;
    };
  }

  window.__homePanelSpotifyEnsure = window.__homePanelSpotifyRobustEnsure;
  return window.__homePanelSpotifyRobustEnsure();
})()
)JS";

constexpr wchar_t kSpotifyRobustPodcastScript[] = LR"JS(
(() => {
  const showUrl = 'https://open.spotify.com/show/2ZQy2mlwQodabAILwZ02Ed';
  const showPath = '/show/2ZQy2mlwQodabAILwZ02Ed';
  const mode = 'podcast';
  const playbackRate = 3.0;
  const report = playing => {
    if (window.chrome && window.chrome.webview) {
      window.chrome.webview.postMessage(
          playing ? 'spotify:playing' : 'spotify:not-playing');
    }
  };
  const visible = element => {
    if (!element || element.disabled) return false;
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' &&
           style.pointerEvents !== 'none' && rect.width > 0 && rect.height > 0;
  };
  const labelOf = element =>
      ((element && element.getAttribute('aria-label')) || '').toLowerCase();
  const buttonShowsPlaying = button => {
    const label = labelOf(button);
    return label.includes('pause') || label.includes('一時停止');
  };
  const mediaElement = () => {
    const items = Array.from(document.querySelectorAll('audio, video'));
    return items.find(item => !item.paused && !item.ended) || items[0] || null;
  };
  const playerControl = () =>
      document.querySelector('button[data-testid="control-button-playpause"]');
  const latestEpisodeButton = () => {
    const links = Array.from(document.querySelectorAll('a[href*="/episode/"]'))
        .filter(visible);
    if (links.length) {
      const latest = links[0];
      const container = latest.closest(
          '[data-testid="episode-item"], [data-testid="episode-row"], '
          + '[role="row"], li') || latest.parentElement?.parentElement;
      const button = container?.querySelector('button[data-testid="play-button"]');
      if (visible(button)) return button;
    }
    return Array.from(document.querySelectorAll(
        'button[data-testid="play-button"]')).find(visible) || null;
  };
  const repeatState = button => {
    if (!button) return 'unknown';
    const checked = button.getAttribute('aria-checked');
    if (checked === 'true') return 'context';
    if (checked === 'mixed') return 'one';
    if (checked === 'false') return 'off';
    const label = labelOf(button);
    if (label.includes('enable repeat one') ||
        label.includes('1曲リピートをオン') ||
        label.includes('1曲リピートを有効')) return 'context';
    if (label.includes('disable repeat') ||
        label.includes('リピートをオフ') ||
        label.includes('リピートを無効')) return 'one';
    if (label.includes('enable repeat') ||
        label.includes('リピートをオン') ||
        label.includes('リピートを有効')) return 'off';
    return 'unknown';
  };
  const ensureRepeatOff = () => {
    const repeat = document.querySelector(
        'button[data-testid="control-button-repeat"]');
    if (!visible(repeat)) return;
    const state = repeatState(repeat);
    if (state === 'off' || state === 'unknown') return;
    try { repeat.click(); } catch (_) {}
    if (state === 'context') {
      window.setTimeout(() => {
        const current = document.querySelector(
            'button[data-testid="control-button-repeat"]');
        if (!visible(current)) return;
        if (repeatState(current) === 'one') {
          try { current.click(); } catch (_) {}
        }
      }, 250);
    }
  };
  const ensureRate = () => {
    document.querySelectorAll('audio, video').forEach(media => {
      try {
        media.defaultPlaybackRate = playbackRate;
        if (media.playbackRate !== playbackRate) media.playbackRate = playbackRate;
      } catch (_) {
      }
    });
  };

  if (window.__homePanelSpotifyRobustMode !== mode ||
      typeof window.__homePanelSpotifyRobustEnsure !== 'function') {
    window.__homePanelSpotifyRobustMode = mode;
    window.__homePanelSpotifyRobustState = {
      media: null,
      time: NaN,
      stalled: 0,
    };
    window.__homePanelSpotifyRobustEnsure = () => {
      if (location.hostname !== 'open.spotify.com') {
        report(false);
        return false;
      }
      const onShow = location.pathname.endsWith(showPath);
      const onEpisode = location.pathname.includes('/episode/');
      if (!onShow && !onEpisode) {
        report(false);
        return false;
      }
      ensureRate();
      ensureRepeatOff();
      const state = window.__homePanelSpotifyRobustState;
      const media = mediaElement();
      const control = playerControl();
      let playing = false;

      if (media) {
        const current = Number.isFinite(media.currentTime) ? media.currentTime : NaN;
        const ready = !media.paused && !media.ended && media.readyState >= 2;
        if (ready) {
          if (media !== state.media || !Number.isFinite(state.time) ||
              !Number.isFinite(current) || Math.abs(current - state.time) >= 0.5) {
            state.stalled = 0;
          } else {
            ++state.stalled;
          }
          playing = state.stalled < 2;
        } else {
          state.stalled = 2;
        }
        state.media = media;
        state.time = current;
      } else {
        state.media = null;
        state.time = NaN;
        state.stalled = 0;
        playing = buttonShowsPlaying(control);
      }

      if (media && media.ended && onEpisode) {
        report(false);
        location.replace(showUrl);
        return false;
      }
      if (!playing && media && !media.ended) {
        try {
          const promise = media.play();
          if (promise && typeof promise.then === 'function') {
            promise.then(() => {
              ensureRate();
              report(true);
            }).catch(() => report(false));
            return false;
          }
        } catch (_) {
        }
      }
      if (!playing) {
        let button = null;
        if (onShow && (!media || media.ended)) button = latestEpisodeButton();
        if (!visible(button) && visible(control)) button = control;
        if (!visible(button) && onShow) button = latestEpisodeButton();
        if (visible(button) && !buttonShowsPlaying(button)) {
          try { button.click(); } catch (_) {}
        }
      }
      report(playing || buttonShowsPlaying(playerControl()));
      return playing;
    };
  }

  window.__homePanelSpotifyEnsure = window.__homePanelSpotifyRobustEnsure;
  return window.__homePanelSpotifyRobustEnsure();
})()
)JS";

bool IsSpotifyLoginSource(std::wstring_view source) noexcept {
  return StartsWithInsensitive(source, L"https://accounts.spotify.com/") ||
         StartsWithInsensitive(source, L"https://open.spotify.com/login");
}

bool IsSpotifyOpenSource(std::wstring_view source) noexcept {
  return StartsWithInsensitive(source, L"https://open.spotify.com/");
}

}  // namespace

void SpotifyWebViews::StopLegacySchedulers() noexcept {
  for (Slot& slot : slots_) {
    if (!slot.hostWindow || !IsWindow(slot.hostWindow)) continue;
    KillTimer(slot.hostWindow, kSpotifyModeSwitchTimer);
    if (slot.index == 0) {
      KillTimer(slot.hostWindow, kSpotifyModeTimer);
      KillTimer(slot.hostWindow, kSpotifyPlaybackWatchdogTimer);
    }
  }
}

void SpotifyWebViews::ArmRobustScheduler() noexcept {
  if (slots_.empty()) return;
  HWND host = slots_[0].hostWindow;
  if (!host || !IsWindow(host)) return;
  KillTimer(host, kSpotifyRobustReconcileTimer);
  SetTimer(host, kSpotifyRobustReconcileTimer,
           kSpotifyRobustReconcileTickMs,
           &SpotifyWebViews::ReconcileTimerProc);
}

void CALLBACK SpotifyWebViews::ReconcileTimerProc(
    HWND hwnd, UINT, UINT_PTR timerId, DWORD) {
  if (timerId != kSpotifyRobustReconcileTimer || !hwnd || !IsWindow(hwnd)) return;
  auto* slot = reinterpret_cast<Slot*>(GetWindowLongPtrW(hwnd, GWLP_USERDATA));
  if (!slot || !slot->owner || slot->index != 0) return;
  slot->owner->StopLegacySchedulers();
  slot->owner->ReconcileDesiredMode();
}

bool SpotifyWebViews::SlotIsLoginPage(const Slot& slot) const noexcept {
  if (!slot.webview) return false;
  LPWSTR rawSource = nullptr;
  if (FAILED(slot.webview->get_Source(&rawSource)) || !rawSource) return false;
  const std::wstring source(rawSource);
  CoTaskMemFree(rawSource);
  return IsSpotifyLoginSource(source);
}

bool SpotifyWebViews::SlotMatchesDesiredMode(const Slot& slot) const noexcept {
  if (!slot.webview) return false;
  LPWSTR rawSource = nullptr;
  if (FAILED(slot.webview->get_Source(&rawSource)) || !rawSource) return false;
  const std::wstring source(rawSource);
  CoTaskMemFree(rawSource);
  if (!IsSpotifyOpenSource(source)) return false;
  if (podcastMode_) {
    return source.find(L"/show/2ZQy2mlwQodabAILwZ02Ed") != std::wstring::npos ||
           source.find(L"/episode/") != std::wstring::npos;
  }
  return source.find(L"/playlist/5DQCO4Hv3MbVYHgyXEfx8g") !=
      std::wstring::npos;
}

void SpotifyWebViews::NavigateSlotRobustly(Slot& slot) noexcept {
  if (!slot.webview) return;
  const ULONGLONG now = GetTickCount64();
  if (slot.lastModeNavigateTick != 0 &&
      now - slot.lastModeNavigateTick < kSpotifyRobustNavigateRetryMs) {
    return;
  }
  slot.lastModeNavigateTick = now;
  slot.unhealthyChecks = 0;
  slot.reconcileInFlight = false;
  SetSpotifyOutputMuted(slot.webview);
  slot.webview->ExecuteScript(kSpotifyClearLegacyEnsureScript, nullptr);
  const HRESULT result = slot.webview->Navigate(
      podcastMode_ ? kSpotifyPodcastUrl : kSpotifyPlaylistUrl);
  if (FAILED(result)) slot.lastModeNavigateTick = 0;
}

void SpotifyWebViews::ReconcileDesiredMode() noexcept {
  if (!started_ || slots_.empty()) return;
  const size_t index = reconcileIndex_++ % slots_.size();
  Slot& slot = slots_[index];
  if (!slot.hostWindow || !IsWindow(slot.hostWindow)) return;

  if (!slot.webview) {
    if (!slot.controller) {
      const ULONGLONG now = GetTickCount64();
      if (slot.lastModeNavigateTick == 0 ||
          now - slot.lastModeNavigateTick >= kSpotifyRobustNavigateRetryMs) {
        slot.lastModeNavigateTick = now;
        CreateController(slot);
      }
    }
    return;
  }
  if (SlotIsLoginPage(slot)) {
    slot.unhealthyChecks = 0;
    return;
  }
  if (!SlotMatchesDesiredMode(slot)) {
    NavigateSlotRobustly(slot);
    return;
  }

  slot.lastModeNavigateTick = 0;
  if (slot.reconcileInFlight) return;
  if (slot.playing) {
    slot.unhealthyChecks = 0;
  } else if (++slot.unhealthyChecks >= kSpotifyRobustUnhealthyLimit) {
    NavigateSlotRobustly(slot);
    return;
  }

  slot.reconcileInFlight = true;
  const bool requestedPodcastMode = podcastMode_;
  Slot* const target = &slot;
  const auto alive = alive_;
  const wchar_t* script = requestedPodcastMode
      ? kSpotifyRobustPodcastScript
      : kSpotifyRobustMusicScript;
  const HRESULT started = slot.webview->ExecuteScript(
      script,
      Callback<ICoreWebView2ExecuteScriptCompletedHandler>(
          [this, alive, target, requestedPodcastMode](HRESULT result, LPCWSTR)
              -> HRESULT {
            if (!alive->load(std::memory_order_acquire)) return S_OK;
            target->reconcileInFlight = false;
            if (!started_ || requestedPodcastMode != podcastMode_) return S_OK;
            if (FAILED(result)) {
              target->playing = false;
              ++target->unhealthyChecks;
              RecomputeForeground();
            }
            return S_OK;
          }).Get());
  if (FAILED(started)) {
    slot.reconcileInFlight = false;
    slot.playing = false;
    ++slot.unhealthyChecks;
    RecomputeForeground();
  }
}

void SpotifyWebViews::SetPodcastMode(bool podcastMode) noexcept {
  if (!started_ || slots_.empty()) return;

  StopLegacySchedulers();
  if (!robustSchedulerStarted_) {
    robustSchedulerStarted_ = true;
    reconcileIndex_ = 0;
    for (Slot& slot : slots_) {
      if (slot.index == 0 || !slot.hostWindow || !IsWindow(slot.hostWindow) ||
          slot.controller || slot.webview) {
        continue;
      }
      KillTimer(slot.hostWindow, kSpotifyStartupTimer);
      const UINT delay = static_cast<UINT>(slot.index) *
          kSpotifyRobustStartupStaggerMs;
      if (SetTimer(slot.hostWindow, kSpotifyStartupTimer, delay, nullptr) == 0) {
        CreateController(slot);
      }
    }
  }
  ArmRobustScheduler();

  const bool modeChanged = podcastMode_ != podcastMode;
  podcastMode_ = podcastMode;
  if (modeChanged) {
    reconcileIndex_ = 0;
    for (Slot& slot : slots_) {
      slot.lastModeNavigateTick = 0;
      slot.unhealthyChecks = 0;
      slot.reconcileInFlight = false;
      if (slot.webview) {
        slot.webview->ExecuteScript(kSpotifyClearLegacyEnsureScript, nullptr);
      }
    }
  }
  ReconcileDesiredMode();
}

}  // namespace hp
