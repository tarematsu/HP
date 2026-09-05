namespace hp {
namespace {

struct SpotifyTimedCatalogTrack {
  const wchar_t* title;
  const wchar_t* url;
  const wchar_t* path;
};

constexpr wchar_t kSpotifyBitterBlueUrl[] =
    L"https://open.spotify.com/track/5EjWZuODqEPQ9eq7XCmITh";
constexpr wchar_t kSpotifyBitterBluePath[] =
    L"/track/5EjWZuODqEPQ9eq7XCmITh";
constexpr wchar_t kSpotifyLonesomeRabbitPath[] =
    L"/album/2f2Ik9JeinFVWZuFb3i35b";
constexpr wchar_t kSpotifyTalkAboutShowPath[] =
    L"/show/2ZQy2mlwQodabAILwZ02Ed";

// C/D候補。Spotify上で櫻坂46の通常楽曲かつ2分以上であることを確認した
// URLだけをビルドへ固定する。A=Lonesome rabbit、B=放課後BitterBlueは除外。
constexpr std::array<SpotifyTimedCatalogTrack, 20> kSpotifyRandomCatalogTracks = {{
    {L"UDAGAWA GENERATION",
     L"https://open.spotify.com/track/4ljk3qMzdU81kWzxcNix3F",
     L"/track/4ljk3qMzdU81kWzxcNix3F"},
    {L"I want tomorrow to come",
     L"https://open.spotify.com/track/6ujztecmohAyiBzd21jKZF",
     L"/track/6ujztecmohAyiBzd21jKZF"},
    {L"自業自得",
     L"https://open.spotify.com/track/55owiSiQaWM2YHedWobsmd",
     L"/track/55owiSiQaWM2YHedWobsmd"},
    {L"承認欲求",
     L"https://open.spotify.com/track/3kAccmfdpknDrdDNgEfWi3",
     L"/track/3kAccmfdpknDrdDNgEfWi3"},
    {L"桜月",
     L"https://open.spotify.com/track/65qUpiboIWUHS2xilfsS5d",
     L"/track/65qUpiboIWUHS2xilfsS5d"},
    {L"Anthem time",
     L"https://open.spotify.com/track/5NAhakYBfDrnPwclaAqKQT",
     L"/track/5NAhakYBfDrnPwclaAqKQT"},
    {L"We got your back",
     L"https://open.spotify.com/track/2ze5Hu3eRRe6HxJTfuZaA0",
     L"/track/2ze5Hu3eRRe6HxJTfuZaA0"},
    {L"The growing up train",
     L"https://open.spotify.com/track/49cxVtrML7Xo63UFaaJrUR",
     L"/track/49cxVtrML7Xo63UFaaJrUR"},
    {L"Unhappy birthday構文",
     L"https://open.spotify.com/track/6JlqZHeCFdV6cl9DtSZhR2",
     L"/track/6JlqZHeCFdV6cl9DtSZhR2"},
    {L"狼たちよ",
     L"https://open.spotify.com/track/4IfRFec7SNKOWw1HzpiqHQ",
     L"/track/4IfRFec7SNKOWw1HzpiqHQ"},
    {L"やるしかないじゃん",
     L"https://open.spotify.com/track/6GF0ZgT8wlksWrlLTfGmlU",
     L"/track/6GF0ZgT8wlksWrlLTfGmlU"},
    {L"恋は向いてない",
     L"https://open.spotify.com/track/44sj7vChwZRYQ0Oz9AFyP2",
     L"/track/44sj7vChwZRYQ0Oz9AFyP2"},
    {L"BAN",
     L"https://open.spotify.com/track/563WCw6gfsUCKlLTGYU4p4",
     L"/track/563WCw6gfsUCKlLTGYU4p4"},
    {L"Nobody's fault",
     L"https://open.spotify.com/track/7mOPqaJicc6WdPCZqumP4e",
     L"/track/7mOPqaJicc6WdPCZqumP4e"},
    {L"五月雨よ",
     L"https://open.spotify.com/track/34CdKBveafYqBSzDDmUwRI",
     L"/track/34CdKBveafYqBSzDDmUwRI"},
    {L"無言の宇宙",
     L"https://open.spotify.com/track/78ancRAao1sxvMTv1E3hs3",
     L"/track/78ancRAao1sxvMTv1E3hs3"},
    {L"泣かせて Hold me tight!",
     L"https://open.spotify.com/track/31vLfN5bNOpasgULiqSbLx",
     L"/track/31vLfN5bNOpasgULiqSbLx"},
    {L"19歳のガレット",
     L"https://open.spotify.com/track/3Ule6qlH6klo2T3y1Zlgtt",
     L"/track/3Ule6qlH6klo2T3y1Zlgtt"},
    {L"TOKYO SNOW",
     L"https://open.spotify.com/track/307SI8AgVvBbNTkNrETKHW",
     L"/track/307SI8AgVvBbNTkNrETKHW"},
    {L"Start over!",
     L"https://open.spotify.com/track/0lIgXSxKgRUjF0SiN19MmJ",
     L"/track/0lIgXSxKgRUjF0SiN19MmJ"},
}};

static_assert(kSpotifyRandomCatalogTracks.size() >= 2);

const SpotifyTimedCatalogTrack* TimedCatalogTrack(size_t index) noexcept {
  if (index >= kSpotifyRandomCatalogTracks.size()) return nullptr;
  return &kSpotifyRandomCatalogTracks[index];
}

constexpr wchar_t kSpotifyTimedTrackScriptTemplate[] = LR"JS(
(() => {
  const targetPath = '__TARGET_PATH__';
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
  if ((buttonShowsPlaying(control) && nowPlayingTarget()) ||
      buttonShowsPlaying(targetButton)) {
    report(true);
    return true;
  }

  report(false);
  return point(visible(targetButton) ? targetButton : control);
})()
)JS";

std::wstring BuildTimedTrackScript(std::wstring_view targetPath) {
  std::wstring script(kSpotifyTimedTrackScriptTemplate);
  constexpr std::wstring_view marker = L"__TARGET_PATH__";
  const size_t pos = script.find(marker);
  if (pos != std::wstring::npos) {
    script.replace(pos, marker.size(), targetPath.data(), targetPath.size());
  }
  return script;
}

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
        const buttons = Array.from(row.querySelectorAll(
            'button[data-testid="play-button"], button, [role="button"]'));
        const target = buttons.find(button => {
          if (!visible(button)) return false;
          const label = labelOf(button);
          return label === 'play' || label === '再生' ||
                 label.includes(targetTitle);
        });
        if (target) return target;
      }
    }
    return Array.from(document.querySelectorAll(
        'button[data-testid="play-button"]')).find(visible) || null;
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

const wchar_t* TimedSpotifyUrl(
    SpotifyWebViews::TimedSpotifyTarget target,
    size_t catalogIndex) noexcept {
  switch (target) {
    case SpotifyWebViews::TimedSpotifyTarget::BitterBlue:
      return kSpotifyBitterBlueUrl;
    case SpotifyWebViews::TimedSpotifyTarget::TalkAbout:
      return kSpotifyPodcastUrl;
    case SpotifyWebViews::TimedSpotifyTarget::LonesomeRabbit:
      return kSpotifyPlaylistUrl;
    case SpotifyWebViews::TimedSpotifyTarget::CatalogTrack: {
      const SpotifyTimedCatalogTrack* track = TimedCatalogTrack(catalogIndex);
      return track ? track->url : nullptr;
    }
    case SpotifyWebViews::TimedSpotifyTarget::None:
      return nullptr;
  }
  return nullptr;
}

}  // namespace

size_t SpotifyWebViews::PickTimedRandomCatalogIndex(size_t avoidIndex) noexcept {
  if (timedRandomState_ == 0) {
    LARGE_INTEGER counter{};
    QueryPerformanceCounter(&counter);
    timedRandomState_ =
        GetTickCount64() ^ static_cast<ULONGLONG>(counter.QuadPart) ^
        static_cast<ULONGLONG>(reinterpret_cast<ULONG_PTR>(this));
    if (timedRandomState_ == 0) {
      timedRandomState_ = 0x9E3779B97F4A7C15ULL;
    }
  }

  ULONGLONG x = timedRandomState_;
  x ^= x >> 12;
  x ^= x << 25;
  x ^= x >> 27;
  timedRandomState_ = x;
  const ULONGLONG mixed = x * 2685821657736338717ULL;
  const size_t count = kSpotifyRandomCatalogTracks.size();
  size_t index = static_cast<size_t>(mixed % count);
  if (avoidIndex < count && index == avoidIndex) {
    const size_t offset =
        1 + static_cast<size_t>((mixed >> 32) % (count - 1));
    index = (avoidIndex + offset) % count;
  }
  return index;
}

void SpotifyWebViews::EnsureTimedRandomPair(ULONGLONG rotationCycle) noexcept {
  if (timedRandomPairCycle_ == rotationCycle &&
      timedRandomCIndex_ < kSpotifyRandomCatalogTracks.size() &&
      timedRandomDIndex_ < kSpotifyRandomCatalogTracks.size() &&
      timedRandomCIndex_ != timedRandomDIndex_) {
    return;
  }

  timedRandomCIndex_ = PickTimedRandomCatalogIndex(kNoTimedCatalogIndex);
  timedRandomDIndex_ = PickTimedRandomCatalogIndex(timedRandomCIndex_);
  timedRandomPairCycle_ = rotationCycle;
}

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
    case TimedSpotifyTarget::CatalogTrack: {
      const SpotifyTimedCatalogTrack* track =
          TimedCatalogTrack(slot.timedCatalogIndex);
      return track && source.find(track->path) != std::wstring::npos;
    }
    case TimedSpotifyTarget::None:
      return false;
  }
  return false;
}

void SpotifyWebViews::NavigateTimedSlot(Slot& slot) noexcept {
  if (!slot.webview) return;
  const wchar_t* url = TimedSpotifyUrl(slot.timedTarget, slot.timedCatalogIndex);
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

  std::wstring dynamicTrackScript;
  const wchar_t* script = nullptr;
  switch (slot.timedTarget) {
    case TimedSpotifyTarget::BitterBlue:
      dynamicTrackScript = BuildTimedTrackScript(kSpotifyBitterBluePath);
      script = dynamicTrackScript.c_str();
      break;
    case TimedSpotifyTarget::TalkAbout:
      script = kSpotifyTimedTalkAboutScript;
      break;
    case TimedSpotifyTarget::LonesomeRabbit:
      script = kSpotifyTimedLonesomeScript;
      break;
    case TimedSpotifyTarget::CatalogTrack: {
      const SpotifyTimedCatalogTrack* track =
          TimedCatalogTrack(slot.timedCatalogIndex);
      if (!track) return;
      dynamicTrackScript = BuildTimedTrackScript(track->path);
      script = dynamicTrackScript.c_str();
      break;
    }
    case TimedSpotifyTarget::None:
      return;
  }

  slot.reconcileInFlight = true;
  const TimedSpotifyTarget requestedTarget = slot.timedTarget;
  const size_t requestedCatalogIndex = slot.timedCatalogIndex;
  Slot* const target = &slot;
  const auto alive = alive_;
  const HRESULT started = slot.webview->ExecuteScript(
      script,
      Callback<ICoreWebView2ExecuteScriptCompletedHandler>(
          [this, alive, target, requestedTarget, requestedCatalogIndex](
              HRESULT result, LPCWSTR json) -> HRESULT {
            if (!alive->load(std::memory_order_acquire)) return S_OK;
            target->reconcileInFlight = false;
            if (!started_ || requestedTarget != target->timedTarget ||
                (requestedTarget == TimedSpotifyTarget::CatalogTrack &&
                 requestedCatalogIndex != target->timedCatalogIndex)) {
              return S_OK;
            }

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
              target->timedCatalogIndex = kNoTimedCatalogIndex;
              target->lastTimedRotationWave = ~0ULL;
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
