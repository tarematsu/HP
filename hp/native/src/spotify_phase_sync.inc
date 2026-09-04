namespace hp {
namespace {

constexpr UINT_PTR kSpotifyRobustReconcileTimer = 0x53505243;
constexpr UINT kSpotifyRobustReconcileTickMs = 2U * 1000U;
constexpr ULONGLONG kSpotifyRobustNavigateRetryMs = 20ULL * 1000ULL;
constexpr ULONGLONG kSpotifyRobustControllerRetryMs = 20ULL * 1000ULL;
constexpr int kSpotifyRobustUnhealthyLimit = 3;

constexpr wchar_t kSpotifyClearLegacyEnsureScript[] = LR"JS(
(() => {
  window.__homePanelSpotifyEnsure = null;
  window.__homePanelSpotifyRobustMode = 'switching';
  window.__homePanelSakuraPlaylistLoop = false;
  window.__homePanelSakuraTalkAboutPlayback = false;
})()
)JS";

constexpr wchar_t kSpotifyRobustMusicScript[] = LR"JS(
(() => {
  const playlistPath = '/playlist/5DQCO4Hv3MbVYHgyXEfx8g';
  const report = playing => {
    if (window.chrome && window.chrome.webview) {
      window.chrome.webview.postMessage(
          playing ? 'spotify:playing' : 'spotify:not-playing');
    }
  };
  const visible = element => {
    if (!element || element.disabled ||
        element.getAttribute('aria-disabled') === 'true') return false;
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' &&
           style.pointerEvents !== 'none' && rect.width > 0 && rect.height > 0;
  };
  const labelOf = element =>
      ((element && (element.getAttribute('aria-label') ||
                    element.getAttribute('title'))) || '')
          .replace(/\s+/g, ' ').trim().toLowerCase();
  const buttonShowsPlaying = button => {
    const label = labelOf(button);
    return label.includes('pause') || label.includes('一時停止');
  };
  const playerControl = () => {
    const primary = document.querySelector(
        'button[data-testid="control-button-playpause"]');
    if (visible(primary)) return primary;
    return Array.from(document.querySelectorAll('button, [role="button"]'))
        .find(button => {
          if (!visible(button)) return false;
          const label = labelOf(button);
          return label === 'play' || label === 'pause' ||
                 label === '再生' || label === '一時停止';
        }) || null;
  };
  const playlistPlayButton = () => {
    const primary = Array.from(document.querySelectorAll(
        'button[data-testid="play-button"]')).find(visible);
    if (primary) return primary;
    return Array.from(document.querySelectorAll('button, [role="button"]'))
        .find(button => {
          if (!visible(button)) return false;
          const label = labelOf(button);
          if (/speed|速度/.test(label)) return false;
          return label === 'play' || label === '再生' ||
                 label.startsWith('play ') || label.endsWith('を再生');
        }) || null;
  };
  const point = element => {
    if (!visible(element) || window.innerWidth <= 0 || window.innerHeight <= 0) {
      return null;
    }
    const rect = element.getBoundingClientRect();
    return [
      Math.max(0, Math.min(10000, Math.round(
          ((rect.left + rect.width / 2) / window.innerWidth) * 10000))),
      Math.max(0, Math.min(10000, Math.round(
          ((rect.top + rect.height / 2) / window.innerHeight) * 10000)))
    ];
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
  const ensureContextRepeat = () => {
    const repeat = document.querySelector(
        'button[data-testid="control-button-repeat"]');
    if (!visible(repeat)) return;
    const state = repeatState(repeat);
    if (state === 'context' || state === 'unknown') return;
    try { repeat.click(); } catch (_) { return; }
    if (state === 'one') {
      window.setTimeout(() => {
        const current = document.querySelector(
            'button[data-testid="control-button-repeat"]');
        if (visible(current) && repeatState(current) === 'off') {
          try { current.click(); } catch (_) {}
        }
      }, 250);
    }
  };

  if (location.hostname !== 'open.spotify.com' ||
      !location.pathname.endsWith(playlistPath)) {
    report(false);
    return null;
  }

  ensureContextRepeat();
  const control = playerControl();
  if (buttonShowsPlaying(control)) {
    report(true);
    return true;
  }

  report(false);
  const button = visible(control) ? control : playlistPlayButton();
  return point(button);
})()
)JS";

constexpr wchar_t kSpotifyRobustPodcastScript[] = LR"JS(
(() => {
  const showUrl = 'https://open.spotify.com/show/2ZQy2mlwQodabAILwZ02Ed';
  const showPath = '/show/2ZQy2mlwQodabAILwZ02Ed';
  const playbackRate = 3.0;
  const report = playing => {
    if (window.chrome && window.chrome.webview) {
      window.chrome.webview.postMessage(
          playing ? 'spotify:playing' : 'spotify:not-playing');
    }
  };
  const visible = element => {
    if (!element || element.disabled ||
        element.getAttribute('aria-disabled') === 'true') return false;
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' &&
           style.pointerEvents !== 'none' && rect.width > 0 && rect.height > 0;
  };
  const labelOf = element =>
      ((element && (element.getAttribute('aria-label') ||
                    element.getAttribute('title'))) || '')
          .replace(/\s+/g, ' ').trim().toLowerCase();
  const buttonShowsPlaying = button => {
    const label = labelOf(button);
    return label.includes('pause') || label.includes('一時停止');
  };
  const playerControl = () => {
    const primary = document.querySelector(
        'button[data-testid="control-button-playpause"]');
    if (visible(primary)) return primary;
    return Array.from(document.querySelectorAll('button, [role="button"]'))
        .find(button => {
          if (!visible(button)) return false;
          const label = labelOf(button);
          return label === 'play' || label === 'pause' ||
                 label === '再生' || label === '一時停止';
        }) || null;
  };
  const playButtonIn = root => {
    if (!root) return null;
    const primary = Array.from(root.querySelectorAll(
        'button[data-testid="play-button"]')).find(visible);
    if (primary) return primary;
    return Array.from(root.querySelectorAll('button, [role="button"]'))
        .find(button => {
          if (!visible(button)) return false;
          const label = labelOf(button);
          if (/speed|速度/.test(label)) return false;
          return label === 'play' || label === '再生' ||
                 label.startsWith('play ') || label.endsWith('を再生');
        }) || null;
  };
  const latestEpisodeButton = () => {
    const links = Array.from(document.querySelectorAll('a[href*="/episode/"]'))
        .filter(visible);
    if (links.length) {
      const latest = links[0];
      const container = latest.closest(
          '[data-testid="episode-item"], [data-testid="episode-row"], '
          + '[role="row"], li') || latest.parentElement?.parentElement;
      const button = playButtonIn(container);
      if (visible(button)) return button;
    }
    return playButtonIn(document);
  };
  const point = element => {
    if (!visible(element) || window.innerWidth <= 0 || window.innerHeight <= 0) {
      return null;
    }
    const rect = element.getBoundingClientRect();
    return [
      Math.max(0, Math.min(10000, Math.round(
          ((rect.left + rect.width / 2) / window.innerWidth) * 10000))),
      Math.max(0, Math.min(10000, Math.round(
          ((rect.top + rect.height / 2) / window.innerHeight) * 10000)))
    ];
  };
  const repeatState = button => {
    if (!button) return 'unknown';
    const checked = button.getAttribute('aria-checked');
    if (checked === 'true') return 'context';
    if (checked === 'mixed') return 'one';
    if (checked === 'false') return 'off';
    const label = labelOf(button);
    if (label.includes('disable repeat') ||
        label.includes('リピートをオフ') ||
        label.includes('リピートを無効')) return 'one';
    if (label.includes('enable repeat one') ||
        label.includes('1曲リピートをオン') ||
        label.includes('1曲リピートを有効')) return 'context';
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
    try { repeat.click(); } catch (_) { return; }
    if (state === 'context') {
      window.setTimeout(() => {
        const current = document.querySelector(
            'button[data-testid="control-button-repeat"]');
        if (visible(current) && repeatState(current) === 'one') {
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
      } catch (_) {}
    });
  };

  if (location.hostname !== 'open.spotify.com') {
    report(false);
    return null;
  }
  const onShow = location.pathname.endsWith(showPath);
  const onEpisode = location.pathname.includes('/episode/');
  if (!onShow && !onEpisode) {
    report(false);
    return null;
  }

  ensureRate();
  ensureRepeatOff();
  const media = Array.from(document.querySelectorAll('audio, video'))
      .find(item => item && item.ended) || null;
  if (media && media.ended && onEpisode) {
    report(false);
    location.replace(showUrl);
    return null;
  }

  const control = playerControl();
  if (buttonShowsPlaying(control)) {
    report(true);
    return true;
  }

  report(false);
  let button = null;
  if (onShow) button = latestEpisodeButton();
  if (!visible(button) && visible(control)) button = control;
  if (!visible(button)) button = playButtonIn(document);
  return point(button);
})()
)JS";

bool IsSpotifyLoginSource(std::wstring_view source) noexcept {
  return StartsWithInsensitive(source, L"https://accounts.spotify.com/") ||
         StartsWithInsensitive(source, L"https://open.spotify.com/login");
}

bool IsSpotifyOpenSource(std::wstring_view source) noexcept {
  return StartsWithInsensitive(source, L"https://open.spotify.com/");
}

LONG SpotifyAbsoluteMouseCoordinate(int value, int origin, int span) noexcept {
  if (span <= 1) return 0;
  long long scaled =
      (static_cast<long long>(value - origin) * 65535LL) / (span - 1);
  scaled = std::max(0LL, std::min(65535LL, scaled));
  return static_cast<LONG>(scaled);
}

}  // namespace

void SpotifyWebViews::StopLegacySchedulers() noexcept {
  for (Slot& slot : slots_) {
    if (!slot.hostWindow || !IsWindow(slot.hostWindow)) continue;
    KillTimer(slot.hostWindow, kSpotifyStartupTimer);
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

void SpotifyWebViews::BeginControllerCreate(Slot& slot) noexcept {
  if (!slot.hostWindow || !IsWindow(slot.hostWindow) ||
      slot.controller || slot.webview) {
    slot.controllerCreating = false;
    slot.controllerCreateTick = 0;
    return;
  }

  const ULONGLONG now = GetTickCount64();
  if (slot.controllerCreating && slot.controllerCreateTick != 0 &&
      now - slot.controllerCreateTick < kSpotifyRobustControllerRetryMs) {
    return;
  }

  KillTimer(slot.hostWindow, kSpotifyStartupTimer);
  slot.controllerCreating = true;
  slot.controllerCreateTick = now;
  CreateController(slot);
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
  slot.playing = false;
  SetSpotifyOutputMuted(slot.webview);
  slot.webview->ExecuteScript(kSpotifyClearLegacyEnsureScript, nullptr);
  RecomputeForeground();
  const HRESULT result = slot.webview->Navigate(
      podcastMode_ ? kSpotifyPodcastUrl : kSpotifyPlaylistUrl);
  if (FAILED(result)) slot.lastModeNavigateTick = 0;
}

bool SpotifyWebViews::ParseNormalizedPoint(
    LPCWSTR json, int* x, int* y) noexcept {
  if (!json || !x || !y) return false;
  try {
    const std::wstring value(json);
    if (value.size() < 5 || value.front() != L'[') return false;
    const size_t comma = value.find(L',');
    const size_t close = value.find(
        L']', comma == std::wstring::npos ? 0 : comma + 1);
    if (comma == std::wstring::npos || close == std::wstring::npos) return false;
    const int parsedX = std::stoi(value.substr(1, comma - 1));
    const int parsedY = std::stoi(value.substr(comma + 1, close - comma - 1));
    if (parsedX < 0 || parsedX > 10000 || parsedY < 0 || parsedY > 10000) {
      return false;
    }
    *x = parsedX;
    *y = parsedY;
    return true;
  } catch (...) {
    return false;
  }
}

void SpotifyWebViews::ClickSlotNormalizedPoint(
    Slot& slot, int xTenThousandths, int yTenThousandths) noexcept {
  if (!slot.hostWindow || !IsWindow(slot.hostWindow)) return;

  slot.playing = false;
  RecomputeForeground();

  RECT client{};
  if (!GetClientRect(slot.hostWindow, &client)) return;
  const LONG width = client.right - client.left;
  const LONG height = client.bottom - client.top;
  if (width <= 1 || height <= 1) return;

  POINT target{};
  target.x = client.left + static_cast<LONG>(
      (static_cast<long long>(width) * xTenThousandths) / 10000LL);
  target.y = client.top + static_cast<LONG>(
      (static_cast<long long>(height) * yTenThousandths) / 10000LL);
  target.x = std::max(client.left, std::min(client.right - 1, target.x));
  target.y = std::max(client.top, std::min(client.bottom - 1, target.y));
  if (!ClientToScreen(slot.hostWindow, &target)) return;

  const int virtualLeft = GetSystemMetrics(SM_XVIRTUALSCREEN);
  const int virtualTop = GetSystemMetrics(SM_YVIRTUALSCREEN);
  const int virtualWidth = GetSystemMetrics(SM_CXVIRTUALSCREEN);
  const int virtualHeight = GetSystemMetrics(SM_CYVIRTUALSCREEN);
  if (virtualWidth <= 1 || virtualHeight <= 1) return;

  auto setMove = [&](INPUT* input, const POINT& point) noexcept {
    input->type = INPUT_MOUSE;
    input->mi.dx = SpotifyAbsoluteMouseCoordinate(
        point.x, virtualLeft, virtualWidth);
    input->mi.dy = SpotifyAbsoluteMouseCoordinate(
        point.y, virtualTop, virtualHeight);
    input->mi.dwFlags = MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE |
                        MOUSEEVENTF_VIRTUALDESK;
  };

  INPUT inputs[4]{};
  setMove(&inputs[0], target);
  inputs[1].type = INPUT_MOUSE;
  inputs[1].mi.dwFlags = MOUSEEVENTF_LEFTDOWN;
  inputs[2].type = INPUT_MOUSE;
  inputs[2].mi.dwFlags = MOUSEEVENTF_LEFTUP;
  POINT previous{};
  UINT count = 3;
  if (GetCursorPos(&previous)) {
    setMove(&inputs[3], previous);
    count = 4;
  }
  SendInput(count, inputs, sizeof(INPUT));
}

void SpotifyWebViews::ReconcileDesiredMode() noexcept {
  if (!started_ || slots_.empty()) return;
  const size_t index = reconcileIndex_++ % slots_.size();
  Slot& slot = slots_[index];
  if (!slot.hostWindow || !IsWindow(slot.hostWindow)) return;

  if (!slot.webview) {
    BeginControllerCreate(slot);
    return;
  }
  slot.controllerCreating = false;
  slot.controllerCreateTick = 0;

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
          [this, alive, target, requestedPodcastMode](HRESULT result, LPCWSTR json)
              -> HRESULT {
            if (!alive->load(std::memory_order_acquire)) return S_OK;
            target->reconcileInFlight = false;
            if (!started_ || requestedPodcastMode != podcastMode_) return S_OK;

            if (FAILED(result)) {
              target->playing = false;
              if (++target->unhealthyChecks >= kSpotifyRobustUnhealthyLimit) {
                NavigateSlotRobustly(*target);
              } else {
                RecomputeForeground();
              }
              return S_OK;
            }

            if (json && std::wstring_view(json) == L"true") {
              target->playing = true;
              target->unhealthyChecks = 0;
              RecomputeForeground();
              return S_OK;
            }

            int x = 0;
            int y = 0;
            const bool hasPoint = ParseNormalizedPoint(json, &x, &y);
            target->playing = false;
            if (++target->unhealthyChecks >= kSpotifyRobustUnhealthyLimit) {
              NavigateSlotRobustly(*target);
              return S_OK;
            }
            RecomputeForeground();
            if (hasPoint) ClickSlotNormalizedPoint(*target, x, y);
            return S_OK;
          }).Get());
  if (FAILED(started)) {
    slot.reconcileInFlight = false;
    slot.playing = false;
    if (++slot.unhealthyChecks >= kSpotifyRobustUnhealthyLimit) {
      NavigateSlotRobustly(slot);
    } else {
      RecomputeForeground();
    }
  }
}

void SpotifyWebViews::SetPodcastMode(bool podcastMode) noexcept {
  if (!started_ || slots_.empty()) return;

  StopLegacySchedulers();
  if (!robustSchedulerStarted_) {
    robustSchedulerStarted_ = true;
    reconcileIndex_ = 0;

    // Start() already requested slot 0 synchronously. Mark that one request as
    // in-flight, then let the reconciler own creation of slots 1-5. This avoids
    // the legacy startup timers and the reconciler creating the same controller
    // concurrently on slower machines.
    Slot& first = slots_[0];
    if (!first.controller && !first.webview) {
      first.controllerCreating = true;
      first.controllerCreateTick = GetTickCount64();
    }
    for (size_t i = 1; i < slots_.size(); ++i) {
      slots_[i].controllerCreating = false;
      slots_[i].controllerCreateTick = 0;
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
      slot.playing = false;
      if (slot.webview) {
        slot.webview->ExecuteScript(kSpotifyClearLegacyEnsureScript, nullptr);
      }
    }
    RecomputeForeground();
  }
  ReconcileDesiredMode();
}
