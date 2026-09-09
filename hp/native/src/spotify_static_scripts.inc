namespace hp {
namespace {

constexpr wchar_t kSpotifyMessageSeparator = L'\x1f';
constexpr std::array<std::wstring_view, 6> kSpotifyPanelNames = {
    L"amazon", L"yuukiar", L"ten", L"nagi", L"hinata", L"ozeki"};

constexpr wchar_t kSpotifyStaticPageBootstrapScript[] = LR"JS(
(() => {
  const styleId = '__homePanelSpotifyStaticLightweight';
  if (!document.getElementById(styleId)) {
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      *, *::before, *::after {
        animation: none !important;
        transition: none !important;
        scroll-behavior: auto !important;
        background-image: none !important;
        box-shadow: none !important;
        filter: none !important;
        backdrop-filter: none !important;
      }
      img, picture, video, canvas {
        display: none !important;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  const mountBadge = text => {
    if (!text) return;
    let badge = document.getElementById('__homePanelSpotifyAccount');
    if (!badge) {
      badge = document.createElement('div');
      badge.id = '__homePanelSpotifyAccount';
      badge.style.cssText =
          'position:fixed;left:8px;top:8px;z-index:2147483647;' +
          'padding:4px 7px;border-radius:4px;background:rgba(0,0,0,.78);' +
          'color:#fff;font:600 14px/1.2 "Segoe UI",sans-serif;' +
          'pointer-events:none;';
      (document.body || document.documentElement).appendChild(badge);
    }
    badge.textContent = text;
  };

  if (window.__homePanelSpotifyStaticBridgeInstalled) return true;
  window.__homePanelSpotifyStaticBridgeInstalled = true;
  window.__homePanelSpotifyNativeTarget = null;

  if (window.chrome && window.chrome.webview) {
    window.chrome.webview.addEventListener('message', event => {
      if (typeof event.data !== 'string') return;
      const fields = event.data.split('\u001f');
      if (fields[0] === 'spotify:account') {
        mountBadge(fields[1] || '');
        return;
      }
      if (fields[0] !== 'spotify:target') return;

      const next = {
        pagePath: fields[1] || '',
        trackPath: fields[2] || '',
        title: (fields[3] || '').replace(/\s+/g, ' ').trim().toLowerCase(),
        kind: fields[4] || ''
      };
      const previous = window.__homePanelSpotifyNativeTarget;
      const changed = !previous ||
          previous.pagePath !== next.pagePath ||
          previous.trackPath !== next.trackPath ||
          previous.title !== next.title ||
          previous.kind !== next.kind;
      window.__homePanelSpotifyNativeTarget = next;
      if (changed) {
        // Cut the old queue before a new direct-track target is reconciled.
        document.querySelectorAll('audio, video').forEach(media => {
          try { media.pause(); } catch (_) {}
        });
        if (next.kind !== 'podcast') {
          window.__homePanelSpotifyPodcastOneShot = null;
        }
      }
    });
  }
  return true;
})()
)JS";

constexpr wchar_t kSpotifyStaticPodcastReconcileScript[] = LR"JS(
(() => {
  const target = window.__homePanelSpotifyNativeTarget;
  const playbackRate = 3.0;
  const report = playing => {
    try {
      if (window.chrome && window.chrome.webview) {
        window.chrome.webview.postMessage(
            playing ? 'spotify:playing' : 'spotify:not-playing');
      }
    } catch (_) {}
  };
  if (!target || target.kind !== 'podcast') {
    report(false);
    return null;
  }

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
      try { latest.scrollIntoView({ block: 'center', inline: 'nearest' }); }
      catch (_) {}
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
    try { element.scrollIntoView({ block: 'center', inline: 'nearest' }); }
    catch (_) {}
    if (!element.isConnected) return null;
    const rect = element.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    if (centerX < 0 || centerX > window.innerWidth ||
        centerY < 0 || centerY > window.innerHeight) return null;
    return [
      Math.max(0, Math.min(10000, Math.round(
          (centerX / window.innerWidth) * 10000))),
      Math.max(0, Math.min(10000, Math.round(
          (centerY / window.innerHeight) * 10000)))
    ];
  };
  const repeatState = button => {
    if (!button) return 'unknown';
    const checked = button.getAttribute('aria-checked');
    if (checked === 'false') return 'off';
    if (checked === 'true') return 'context';
    if (checked === 'mixed') return 'one';
    const label = labelOf(button);
    if (label.includes('enable repeat')) return 'off';
    if (label.includes('disable repeat')) return 'one';
    return 'unknown';
  };
  const repeat = document.querySelector(
      'button[data-testid="control-button-repeat"]');
  if (visible(repeat) && repeatState(repeat) !== 'off' &&
      repeatState(repeat) !== 'unknown') {
    report(false);
    return point(repeat);
  }

  document.querySelectorAll('audio, video').forEach(media => {
    try {
      if (!media.__homePanelSpotifyPodcastRateBound) {
        media.__homePanelSpotifyPodcastRateBound = true;
        media.defaultPlaybackRate = playbackRate;
        media.addEventListener('ratechange', () => {
          if (media.playbackRate !== playbackRate) media.playbackRate = playbackRate;
        }, { passive: true });
      }
      if (media.playbackRate !== playbackRate) media.playbackRate = playbackRate;
    } catch (_) {}
  });

  const oneShot = window.__homePanelSpotifyPodcastOneShot ||
      (window.__homePanelSpotifyPodcastOneShot = {
        started: false,
        completed: false,
        media: new WeakSet()
      });
  document.querySelectorAll('audio, video').forEach(media => {
    if (oneShot.media.has(media)) return;
    oneShot.media.add(media);
    media.addEventListener('play', () => { oneShot.started = true; },
                           { passive: true });
    media.addEventListener('ended', () => {
      if (oneShot.started) oneShot.completed = true;
    }, { passive: true });
  });

  if (location.hostname !== 'open.spotify.com') {
    report(false);
    return null;
  }
  const onShow = location.pathname === target.pagePath;
  const onEpisode = location.pathname.includes('/episode/');
  if (!onShow && !onEpisode) {
    report(false);
    return null;
  }
  if (oneShot.completed) {
    report(false);
    return 'completed';
  }

  const control = playerControl();
  if (buttonShowsPlaying(control)) {
    oneShot.started = true;
    report(true);
    return true;
  }

  report(false);
  const button = onShow ? latestEpisodeButton() : control;
  return point(visible(button) ? button : latestEpisodeButton());
})()
)JS";

constexpr wchar_t kSpotifyStaticStopPlaybackScript[] = LR"JS(
(() => {
  document.querySelectorAll('audio, video').forEach(media => {
    try { media.pause(); } catch (_) {}
  });
  return true;
})()
)JS";

}  // namespace

void SpotifyWebViews::PostSpotifyPageContext(Slot& slot) noexcept {
  if (!slot.webview) return;
  if (slot.index < kSpotifyPanelNames.size()) {
    std::wstring message = L"spotify:account";
    message.push_back(kSpotifyMessageSeparator);
    message.append(kSpotifyPanelNames[slot.index]);
    slot.webview->PostWebMessageAsString(message.c_str());
  }
  PostSpotifyTargetDescriptorForSlot(slot);
}

}  // namespace hp
