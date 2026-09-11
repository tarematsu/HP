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

      const requestedRate = Number(fields[5]);
      const next = {
        pagePath: fields[1] || '',
        trackPath: fields[2] || '',
        title: (fields[3] || '').replace(/\s+/g, ' ').trim().toLowerCase(),
        kind: fields[4] || '',
        playbackRate: Number.isFinite(requestedRate) && requestedRate > 0
            ? requestedRate : 3.0
      };
      const previous = window.__homePanelSpotifyNativeTarget;
      const changed = !!previous &&
          (previous.pagePath !== next.pagePath ||
           previous.trackPath !== next.trackPath ||
           previous.title !== next.title ||
           previous.kind !== next.kind ||
           previous.playbackRate !== next.playbackRate);
      window.__homePanelSpotifyNativeTarget = next;

      // Target messages describe intent only. They never stop media. Playback
      // ownership belongs to the media observer, while target transitions are
      // performed by navigation. Keeping the bridge non-destructive removes the
      // race where an asynchronous target message pauses a freshly started item
      // at currentTime=0.
      if (!previous || changed) {
        window.__homePanelSpotifyPodcastOneShot = null;
      }
    });
  }
  return true;
})()
)JS";

constexpr wchar_t kSpotifyStaticPodcastReconcileScript[] = LR"JS(
(() => {
  const target = window.__homePanelSpotifyNativeTarget;
  const requestedRate = Number(target && target.playbackRate);
  const playbackRate = Number.isFinite(requestedRate)
      ? Math.max(0.5, Math.min(4.0, requestedRate)) : 3.0;
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
  const buttonIntent = button => {
    const label = labelOf(button);
    if (!label) return 'unknown';
    if (label.includes('pause') || label.includes('一時停止')) return 'pause';
    if (label === 'play' || label === '再生' ||
        label.startsWith('play ') || label.endsWith('を再生')) {
      return 'play';
    }
    return 'unknown';
  };
  const playerControl = () => {
    const primary = document.querySelector(
        'button[data-testid="control-button-playpause"]');
    if (visible(primary)) return primary;
    return Array.from(document.querySelectorAll('button, [role="button"]'))
        .find(button => visible(button) && buttonIntent(button) !== 'unknown') ||
        null;
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
          return buttonIntent(button) !== 'unknown';
        }) || null;
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

  const mediaElements = Array.from(document.querySelectorAll('audio, video'));
  mediaElements.forEach(media => {
    try {
      if (!media.__homePanelSpotifyPodcastRateBound) {
        media.__homePanelSpotifyPodcastRateBound = true;
        media.addEventListener('ratechange', () => {
          if (media.playbackRate !== playbackRate) media.playbackRate = playbackRate;
        }, { passive: true });
      }
      media.defaultPlaybackRate = playbackRate;
      if (media.playbackRate !== playbackRate) media.playbackRate = playbackRate;
    } catch (_) {}
  });

  const oneShot = window.__homePanelSpotifyPodcastOneShot ||
      (window.__homePanelSpotifyPodcastOneShot = {
        started: false,
        completed: false,
        media: new WeakSet()
      });
  mediaElements.forEach(media => {
    if (oneShot.media.has(media)) return;
    oneShot.media.add(media);
    media.addEventListener('play', () => { oneShot.started = true; },
                           { passive: true });
    media.addEventListener('ended', () => {
      if (oneShot.started) oneShot.completed = true;
    }, { passive: true });
  });

  if (location.hostname !== 'open.spotify.com' ||
      !target.pagePath.startsWith('/episode/') ||
      location.pathname !== target.pagePath) {
    report(false);
    return null;
  }
  if (oneShot.completed) {
    report(false);
    return 'completed';
  }

  const control = playerControl();
  const episodeButton = playButtonIn(document);
  const controlIntent = buttonIntent(control);
  const episodeIntent = buttonIntent(episodeButton);
  const activeMedia = mediaElements.find(media => !media.ended && !media.paused) || null;

  // A Pause label is not proof that audio started. Spotify can flip its UI
  // before the media clock leaves zero. Only a real play event plus active media
  // confirms podcast playback; otherwise this is a settling state and must not
  // be clicked because that would turn the pending start into an explicit pause.
  if (oneShot.started && activeMedia &&
      (episodeIntent === 'pause' || controlIntent === 'pause')) {
    report(true);
    return true;
  }
  if (episodeIntent === 'pause' || controlIntent === 'pause' || oneShot.started) {
    report(false);
    return 'settling';
  }

  // Never use the global footer Play button to start TALKABOUT. It can resume
  // the previous music queue. Only an explicitly Play-labelled direct episode
  // control is eligible for a trusted click.
  report(false);
  if (episodeIntent === 'play') return point(episodeButton);
  return 'settling';
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
