namespace hp {
namespace {

constexpr wchar_t kSpotifyBitterBlueUrl[] =
    L"https://open.spotify.com/track/5EjWZuODqEPQ9eq7XCmITh";
constexpr wchar_t kSpotifyBitterBluePath[] =
    L"/track/5EjWZuODqEPQ9eq7XCmITh";
constexpr wchar_t kSpotifyLonesomeRabbitPath[] =
    L"/album/2f2Ik9JeinFVWZuFb3i35b";
constexpr wchar_t kSpotifyTalkAboutShowPath[] =
    L"/show/2ZQy2mlwQodabAILwZ02Ed";

constexpr wchar_t kSpotifyTimedBitterBlueScript[] = LR"JS(
(() => {
  const targetPath = '/track/5EjWZuODqEPQ9eq7XCmITh';
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
  const targetPlayButton = () => {
    const primary = Array.from(document.querySelectorAll(
        'button[data-testid="play-button"]')).find(visible);
    if (primary) return primary;
    return Array.from(document.querySelectorAll('button, [role="button"]'))
        .find(button => {
          if (!visible(button)) return false;
          const label = labelOf(button);
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
  const nowPlayingTarget = () => {
    const links = Array.from(document.querySelectorAll(
        '[data-testid="now-playing-widget"] a[href*="/track/"], '
        + '[data-testid="context-item-link"][href*="/track/"]'));
    return links.some(link => {
      try { return new URL(link.href, location.href).pathname === targetPath; }
      catch (_) { return false; }
    });
  };

  if (location.hostname !== 'open.spotify.com' ||
      location.pathname !== targetPath) {
    report(false);
    return null;
  }

  const control = playerControl();
  const targetButton = targetPlayButton();
  if (buttonShowsPlaying(control) && nowPlayingTarget()) {
    report(true);
    return true;
  }

  report(false);
  return point(visible(targetButton) ? targetButton : control);
})()
)JS";

constexpr wchar_t kSpotifyTimedLonesomeScript[] = LR"JS(
(() => {
  const targetPath = '/album/2f2Ik9JeinFVWZuFb3i35b';
  const targetTitle = 'lonesome rabbit';
  const report = playing => {
    if (window.chrome && window.chrome.webview) {
      window.chrome.webview.postMessage(
          playing ? 'spotify:playing' : 'spotify:not-playing');
    }
  };
  const normalize = value => (value || '').replace(/\s+/g, ' ').trim();
  const visible = element => {
    if (!element || element.disabled ||
        element.getAttribute('aria-disabled') === 'true') return false;
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' &&
           style.pointerEvents !== 'none' && rect.width > 0 && rect.height > 0;
  };
  const labelOf = element => normalize(
      (element && (element.getAttribute('aria-label') ||
                   element.getAttribute('title'))) || '').toLowerCase();
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
  const currentTrackTitle = () => {
    const selectors = [
      '[data-testid="now-playing-widget"] [data-testid="context-item-link"]',
      '[data-testid="now-playing-widget"] a[href*="/track/"]',
      '[data-testid="context-item-link"][href*="/track/"]'
    ];
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      const title = normalize(element && element.textContent).toLowerCase();
      if (title) return title;
    }
    const metadata = navigator.mediaSession && navigator.mediaSession.metadata;
    return normalize(metadata && metadata.title).toLowerCase();
  };
  const targetPlayButton = () => {
    const links = Array.from(document.querySelectorAll('a[href*="/track/"]'));
    const targetLink = links.find(link =>
        normalize(link.textContent).toLowerCase() === targetTitle) || null;
    if (targetLink) {
      const row = targetLink.closest(
          '[data-testid="tracklist-row"], [role="row"], li, [aria-rowindex]') ||
          targetLink.parentElement?.parentElement;
      if (row) {
        const rowButtons = Array.from(row.querySelectorAll(
            'button[data-testid="play-button"], button, [role="button"]'));
        const rowPlay = rowButtons.find(button => {
          if (!visible(button)) return false;
          const label = labelOf(button);
          return label === 'play' || label === '再生' ||
                 label.includes(targetTitle) || label.includes('lonesome rabbit');
        });
        if (rowPlay) return rowPlay;
      }
    }
    const primary = Array.from(document.querySelectorAll(
        'button[data-testid="play-button"]')).find(visible);
    if (primary) return primary;
    return null;
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

  if (location.hostname !== 'open.spotify.com' ||
      location.pathname !== targetPath) {
    report(false);
    return null;
  }

  const control = playerControl();
  const currentTitle = currentTrackTitle();
  const targetButton = targetPlayButton();
  if (buttonShowsPlaying(control) && currentTitle === targetTitle) {
    report(true);
    return true;
  }
  if (buttonShowsPlaying(targetButton)) {
    report(true);
    return true;
  }

  report(false);
  return point(currentTitle === targetTitle && visible(control)
      ? control : targetButton);
})()
)JS";

constexpr wchar_t kSpotifyTimedTalkAboutScript[] = LR"JS(
(() => {
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
  const ensureRate = () => {
    document.querySelectorAll('audio, video').forEach(media => {
      try {
        media.defaultPlaybackRate = playbackRate;
        if (media.playbackRate !== playbackRate) media.playbackRate = playbackRate;
      } catch (_) {}
    });
  };
  const currentEpisodeHref = () => {
    const selectors = [
      '[data-testid="now-playing-widget"] a[href*="/episode/"]',
      '[data-testid="context-item-link"][href*="/episode/"]'
    ];
    for (const selector of selectors) {
      const link = document.querySelector(selector);
      if (link && link.getAttribute('href')) return link.getAttribute('href');
    }
    return '';
  };
  const oneShot = window.__homePanelSpotifyTimedPodcastOneShot ||
      (window.__homePanelSpotifyTimedPodcastOneShot = {
        started: false,
        completed: false
      });
  const bindEnded = media => {
    if (!media || media.__homePanelSpotifyTimedPodcastEndedBound) return;
    media.__homePanelSpotifyTimedPodcastEndedBound = true;
    media.addEventListener('ended', () => {
      if (oneShot.started) oneShot.completed = true;
    }, { passive: true });
  };

  if (location.hostname !== 'open.spotify.com') {
    report(false);
    return null;
  }
  const onShow = location.pathname === showPath;
  const onEpisode = location.pathname.includes('/episode/');
  if (!onShow && !onEpisode) {
    report(false);
    return null;
  }

  ensureRate();
  const mediaItems = Array.from(document.querySelectorAll('audio, video'));
  mediaItems.forEach(bindEnded);
  if (oneShot.completed) {
    report(false);
    return 'completed';
  }

  const control = playerControl();
  const episodeContext = onEpisode || currentEpisodeHref().includes('/episode/');
  if (buttonShowsPlaying(control) && episodeContext) {
    oneShot.started = true;
    report(true);
    return true;
  }

  report(false);
  let button = null;
  if (!episodeContext || onShow) button = latestEpisodeButton();
  if (!visible(button) && episodeContext && visible(control)) button = control;
  if (!visible(button)) button = latestEpisodeButton();
  return point(button);
})()
)JS";

const wchar_t* TimedSpotifyUrl(SpotifyWebViews::TimedSpotifyTarget target) noexcept {
  switch (target) {
    case SpotifyWebViews::TimedSpotifyTarget::BitterBlue:
      return kSpotifyBitterBlueUrl;
    case SpotifyWebViews::TimedSpotifyTarget::TalkAbout:
      return kSpotifyPodcastUrl;
    case SpotifyWebViews::TimedSpotifyTarget::LonesomeRabbit:
      return kSpotifyPlaylistUrl;
    case SpotifyWebViews::TimedSpotifyTarget::None:
      return nullptr;
  }
  return nullptr;
}

}  // namespace

bool SpotifyWebViews::SlotMatchesTimedTarget(const Slot& slot) const noexcept {
  if (!slot.webview || slot.timedTarget == TimedSpotifyTarget::None) return false;
  LPWSTR rawSource = nullptr;
  if (FAILED(slot.webview->get_Source(&rawSource)) || !rawSource) return false;
  const std::wstring source(rawSource);
  CoTaskMemFree(rawSource);
  if (!IsSpotifyOpenSource(source)) return false;

  switch (slot.timedTarget) {
    case TimedSpotifyTarget::BitterBlue:
      return source.find(kSpotifyBitterBluePath) != std::wstring::npos;
    case TimedSpotifyTarget::TalkAbout:
      return source.find(kSpotifyTalkAboutShowPath) != std::wstring::npos ||
             source.find(L"/episode/") != std::wstring::npos;
    case TimedSpotifyTarget::LonesomeRabbit:
      return source.find(kSpotifyLonesomeRabbitPath) != std::wstring::npos;
    case TimedSpotifyTarget::None:
      return false;
  }
  return false;
}

void SpotifyWebViews::NavigateTimedSlot(Slot& slot) noexcept {
  if (!slot.webview) return;
  const wchar_t* url = TimedSpotifyUrl(slot.timedTarget);
  if (!url) return;

  slot.lastModeNavigateTick = GetTickCount64();
  slot.unhealthyChecks = 0;
  slot.playing = false;
  SetSpotifyOutputMuted(slot.webview);
  slot.webview->ExecuteScript(kSpotifyClearLegacyEnsureScript, nullptr);
  RecomputeForeground();
  const HRESULT result = slot.webview->Navigate(url);
  if (FAILED(result)) slot.lastModeNavigateTick = 0;
}

void SpotifyWebViews::ReconcileTimedSlot(Slot& slot) noexcept {
  if (!slot.hostWindow || !IsWindow(slot.hostWindow)) return;
  if (!slot.webview) {
    BeginControllerCreate(slot);
    return;
  }
  slot.controllerCreating = false;
  slot.controllerCreateTick = 0;

  if (SlotIsLoginPage(slot) || slot.timedTarget == TimedSpotifyTarget::None) {
    slot.unhealthyChecks = 0;
    return;
  }

  if (!SlotMatchesTimedTarget(slot)) {
    const ULONGLONG now = GetTickCount64();
    if (slot.lastModeNavigateTick == 0 ||
        now - slot.lastModeNavigateTick >= kSpotifyRobustNavigateRetryMs) {
      NavigateTimedSlot(slot);
    }
    return;
  }

  slot.lastModeNavigateTick = 0;
  if (slot.reconcileInFlight) return;

  const wchar_t* script = nullptr;
  switch (slot.timedTarget) {
    case TimedSpotifyTarget::BitterBlue:
      script = kSpotifyTimedBitterBlueScript;
      break;
    case TimedSpotifyTarget::TalkAbout:
      script = kSpotifyTimedTalkAboutScript;
      break;
    case TimedSpotifyTarget::LonesomeRabbit:
      script = kSpotifyTimedLonesomeScript;
      break;
    case TimedSpotifyTarget::None:
      return;
  }

  slot.reconcileInFlight = true;
  const TimedSpotifyTarget requestedTarget = slot.timedTarget;
  Slot* const target = &slot;
  const auto alive = alive_;
  const HRESULT started = slot.webview->ExecuteScript(
      script,
      Callback<ICoreWebView2ExecuteScriptCompletedHandler>(
          [this, alive, target, requestedTarget](HRESULT result, LPCWSTR json)
              -> HRESULT {
            if (!alive->load(std::memory_order_acquire)) return S_OK;
            target->reconcileInFlight = false;
            if (!started_ || requestedTarget != target->timedTarget) return S_OK;

            if (FAILED(result)) {
              target->playing = false;
              if (++target->unhealthyChecks >= kSpotifyRobustReloadThreshold) {
                NavigateTimedSlot(*target);
              } else {
                RecomputeForeground();
              }
              return S_OK;
            }

            if (requestedTarget == TimedSpotifyTarget::TalkAbout && json &&
                std::wstring_view(json) == L"\"completed\"") {
              target->podcastCompleted = true;
              target->timedTarget = TimedSpotifyTarget::LonesomeRabbit;
              target->lastTimedLonesomeWave = ~0ULL;
              target->playing = false;
              target->unhealthyChecks = 0;
              target->lastModeNavigateTick = 0;
              NavigateTimedSlot(*target);
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
            if (hasPoint) {
              target->unhealthyChecks = 0;
              RecomputeForeground();
              ClickSlotNormalizedPoint(*target, x, y);
              return S_OK;
            }

            if (++target->unhealthyChecks >= kSpotifyRobustReloadThreshold) {
              NavigateTimedSlot(*target);
            } else {
              RecomputeForeground();
            }
            return S_OK;
          }).Get());

  if (FAILED(started)) {
    slot.reconcileInFlight = false;
    slot.playing = false;
    if (++slot.unhealthyChecks >= kSpotifyRobustReloadThreshold) {
      NavigateTimedSlot(slot);
    } else {
      RecomputeForeground();
    }
  }
}

}  // namespace hp
