namespace hp {
namespace {

// Minimal playback start/status probe for the already-selected Spotify track:
// 1) the target page remains the navigation authority and first Play waits two
//    seconds after NavigationCompleted bootstrap before trusted input is sent;
// 2) Pause is confirmed only after an available media element has actually
//    advanced; a zero-second stall is recovered only after repeated unchanged
//    observations instead of a wall-clock timeout;
// 3) if the target-page control is omitted entirely, the global Pause control
//    is trusted only after now-playing identity matches the target;
// 4) DOM controls/media are cached per target while they remain connected, so
//    recovery probes avoid repeating full selector scans under renderer load;
// 5) CDP clicks normally target the visible target-page Play control. After a
//    verified zero-second stall, the matching global Play may be used as a
//    recovery-only trusted click target when Spotify omits the page control.
//
// Keep this JavaScript in several literals: MSVC has a relatively small limit
// for one wide string literal, and this reconcile probe intentionally carries
// more state validation than the other Spotify scripts.
constexpr wchar_t kSpotifyScopedTrackReconcileScriptPart1[] = LR"JS(
(() => {
  const target = window.__homePanelSpotifyNativeTarget;
  const targetPath = target &&
      (target.path || target.trackPath || target.pagePath || '');
  if (!targetPath || location.hostname !== 'open.spotify.com') return null;

  const onTargetPage = location.pathname === targetPath ||
      (targetPath.startsWith('/track/') && location.pathname.endsWith(targetPath));
  if (!onTargetPage) return null;

  const playbackProbeMs = 2000;
  const stalledObservationLimit = 4;
  const transitionRetryDelays = [500, 1000, 2000];
  const transitionState = window.__homePanelSpotifyTransitionRetry ||
      (window.__homePanelSpotifyTransitionRetry = { path: '', attempt: 0 });
  if (transitionState.path !== targetPath) {
    transitionState.path = targetPath;
    transitionState.attempt = 0;
  }
  const resetTransitionRetry = () => {
    transitionState.path = targetPath;
    transitionState.attempt = 0;
  };
  const nextTransitionRetryDelay = () => {
    const index = Math.min(
        transitionState.attempt, transitionRetryDelays.length - 1);
    const delay = transitionRetryDelays[index];
    transitionState.attempt = Math.min(
        transitionState.attempt + 1, transitionRetryDelays.length - 1);
    return delay;
  };

  const domCache = window.__homePanelSpotifyDomCache ||
      (window.__homePanelSpotifyDomCache = {
        path: '', pageButtons: null, playerButtons: null,
        nowPlayingLink: null, media: null
      });
  if (domCache.path !== targetPath) {
    domCache.path = targetPath;
    domCache.pageButtons = null;
    domCache.playerButtons = null;
    domCache.nowPlayingLink = null;
    domCache.media = null;
  }

  const normalize = value =>
      String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const enabled = element => !!element && element.isConnected !== false &&
      !element.disabled && element.getAttribute('aria-disabled') !== 'true';
  const cachedButtons = (key, selector) => {
    const cached = Array.isArray(domCache[key])
        ? domCache[key].filter(element => enabled(element))
        : [];
    if (cached.length > 0) {
      domCache[key] = cached;
      return cached;
    }
    const fresh = Array.from(document.querySelectorAll(selector)).filter(enabled);
    domCache[key] = fresh.length > 0 ? fresh : null;
    return fresh;
  };
  const visible = element => {
    if (!enabled(element)) return false;
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' &&
        style.pointerEvents !== 'none' && rect.width > 0 && rect.height > 0;
  };
  const controlLabel = element => normalize(
      element && (element.getAttribute('aria-label') ||
                  element.getAttribute('title')));
  const isPauseControl = element => {
    const label = controlLabel(element);
    return label.includes('pause') || label.includes('一時停止');
  };
  const isPlayControl = element => {
    const label = controlLabel(element);
    return !isPauseControl(element) &&
        (label === 'play' || label.includes('再生'));
  };
  const sameTrackPath = value => !!value &&
      (value === targetPath ||
       (targetPath.startsWith('/track/') && value.endsWith(targetPath)));
  const currentTrackMatchesTarget = () => {
    let link = domCache.nowPlayingLink;
    if (!link || link.isConnected === false) {
      link = null;
      for (const selector of [
        '[data-testid="now-playing-widget"] a[href*="/track/"]',
        '[data-testid="now-playing-bar"] [data-testid="context-item-link"][href*="/track/"]',
        'footer [data-testid="context-item-link"][href*="/track/"]'
      ]) {
        const candidate = document.querySelector(selector);
        if (!candidate) continue;
        link = candidate;
        break;
      }
      domCache.nowPlayingLink = link;
    }
    if (link) {
      try {
        const path = new URL(link.href, location.href).pathname;
        if (path.includes('/track/')) return sameTrackPath(path);
      } catch (_) {
        domCache.nowPlayingLink = null;
      }
    }

    const targetTitle = normalize(target && target.title);
    const metadata = navigator.mediaSession && navigator.mediaSession.metadata;
    const metadataTitle = normalize(metadata && metadata.title);
    return !!targetTitle && !!metadataTitle && metadataTitle === targetTitle;
  };
)JS";

constexpr wchar_t kSpotifyScopedTrackReconcileScriptPart2[] = LR"JS(
  const clearProgressProbe = () => {
    window.__homePanelSpotifyProgressProbe = null;
  };
  const restartPending = () =>
      window.__homePanelSpotifyZeroSecondRestartPath === targetPath;
  const clearRestartPending = () => {
    if (restartPending()) window.__homePanelSpotifyZeroSecondRestartPath = null;
  };
  const targetMedia = () => {
    const cached = domCache.media;
    if (cached && cached.isConnected !== false && !cached.ended) {
      const current = Number(cached.currentTime);
      if (Number.isFinite(current) && current >= 0 && !cached.paused) {
        return cached;
      }
    }
    const media = Array.from(document.querySelectorAll('audio, video')).filter(candidate => {
      if (!candidate || candidate.isConnected === false || candidate.ended) return false;
      const current = Number(candidate.currentTime);
      return Number.isFinite(current) && current >= 0;
    });
    const selected = media.find(candidate => !candidate.paused) || media[0] || null;
    domCache.media = selected;
    return selected;
  };
  const verifyPauseProgress = button => {
    const media = targetMedia();
    if (!media) {
      clearProgressProbe();
      clearRestartPending();
      return 'confirmed';
    }

    const current = Number(media.currentTime);
    if (!Number.isFinite(current) || current < 0) {
      clearProgressProbe();
      clearRestartPending();
      return 'confirmed';
    }

    const previous = window.__homePanelSpotifyProgressProbe;
    if (!previous || previous.path !== targetPath || previous.media !== media ||
        current + 0.05 < previous.currentTime) {
      window.__homePanelSpotifyProgressProbe = {
        path: targetPath,
        media,
        currentTime: current,
        stagnantSamples: 0
      };
      if (current > 0.25) {
        clearProgressProbe();
        clearRestartPending();
        return 'confirmed';
      }
      return 'pending';
    }

    if (current > previous.currentTime + 0.05 || current > 0.25) {
      clearProgressProbe();
      clearRestartPending();
      return 'confirmed';
    }

    previous.currentTime = current;
    previous.stagnantSamples = Number(previous.stagnantSamples || 0) + 1;
    if (previous.stagnantSamples < stalledObservationLimit) return 'pending';

    clearProgressProbe();
    window.__homePanelSpotifyZeroSecondRestartPath = targetPath;
    try {
      // Pausing does not require a trusted user gesture. The subsequent Play
      // still flows through the native CDP trusted-click path.
      button.click();
    } catch (_) {}
    return 'restarted';
  };
  const pauseDecision = button => {
    const result = verifyPauseProgress(button);
    if (result === 'confirmed') return true;
    if (result === 'restarted') return 'restart';
    return playbackProbeMs;
  };

  const point = element => {
    if (!visible(element) || window.innerWidth <= 0 || window.innerHeight <= 0) {
      return null;
    }
    try { element.scrollIntoView({ block: 'center', inline: 'nearest' }); }
    catch (_) {}
    if (element.isConnected === false) return null;
    const rect = element.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    if (!Number.isFinite(centerX) || !Number.isFinite(centerY) ||
        centerX < 0 || centerX > window.innerWidth ||
        centerY < 0 || centerY > window.innerHeight) return null;
    return [centerX, centerY];
  };
)JS";

constexpr wchar_t kSpotifyScopedTrackReconcileErrorRecoveryScript[] = LR"JS(
  // Spotify's Web Player may replace the player with an error surface such as
  // "Something went wrong / RELOAD PAGE". Prefer structural error semantics so
  // this works regardless of the UI language. Text matching is only a fallback
  // when the error container exposes several actions.
  const findErrorRecoveryButton = () => {
    const buttons = Array.from(
        document.querySelectorAll('button,[role="button"]')).filter(visible);
    const semanticToken = element => normalize([
      element.getAttribute('data-testid'),
      element.getAttribute('id'),
      element.getAttribute('name'),
      typeof element.className === 'string' ? element.className : ''
    ].filter(Boolean).join(' '));
    const recoveryToken = /(^|[\s_-])(retry|reload|refresh|reconnect|try[-_]?again)([\s_-]|$)/;
    const explicit = buttons.find(button => recoveryToken.test(semanticToken(button)));
    if (explicit) return explicit;

    const errorRoots = Array.from(document.querySelectorAll([
      '[role="alert"]',
      '[role="alertdialog"]',
      '[data-testid*="error" i]',
      '[id*="error" i]',
      '[class*="error" i]'
    ].join(','))).filter(visible);
    const labelToken = /(retry|reload|refresh|reconnect|try again|再試行|再読み込み|もう一度|再接続|réessayer|reessayer|recharger|actualiser|erneut|nochmal|neu laden|wiederholen|reintentar|recargar|actualizar|riprova|ricarica|tentar novamente|recarregar|다시 시도|새로고침|重试|重試|重新加载|重新載入)/;

    for (const root of errorRoots) {
      const actions = Array.from(
          root.querySelectorAll('button,[role="button"]')).filter(visible);
      const strongErrorSurface =
          root.matches('[role="alertdialog"], [data-testid*="error" i], [id*="error" i], [class*="error" i]') &&
          !!root.querySelector('h1,h2,h3,[role="heading"]');
      if (actions.length === 1 && strongErrorSurface) return actions[0];
      const labeled = actions.find(button => {
        const label = normalize([
          button.getAttribute('aria-label'),
          button.getAttribute('title'),
          button.textContent
        ].filter(Boolean).join(' '));
        return labelToken.test(label);
      });
      if (labeled) return labeled;
    }
    return null;
  };

  const errorRecoveryButton = findErrorRecoveryButton();
  if (errorRecoveryButton) {
    clearProgressProbe();
    clearRestartPending();
    resetTransitionRetry();

    const now = Date.now();
    const recovery = window.__homePanelSpotifyErrorRecovery ||
        (window.__homePanelSpotifyErrorRecovery = {
          path: '', button: null, lastClickAt: 0
        });
    if (recovery.path !== targetPath) {
      recovery.path = targetPath;
      recovery.button = null;
      recovery.lastClickAt = 0;
    }
    if (recovery.button !== errorRecoveryButton ||
        now - Number(recovery.lastClickAt || 0) >= 3000) {
      recovery.button = errorRecoveryButton;
      recovery.lastClickAt = now;
      try { errorRecoveryButton.click(); } catch (_) {}
    }
    return playbackProbeMs;
  }
)JS";

constexpr wchar_t kSpotifyScopedTrackReconcileScriptPart3[] = LR"JS(
  const nativeLoadedAt = Number(window.__homePanelSpotifyNativeLoadedAt);
  const initialPlayDelayElapsed = Number.isFinite(nativeLoadedAt) &&
      Date.now() - nativeLoadedAt >= 2000;

  const pageButtons = cachedButtons(
      'pageButtons', 'button[data-testid="play-button"]');
  const visiblePageButton = pageButtons.find(visible) || null;
  if (visiblePageButton) {
    resetTransitionRetry();
    if (isPauseControl(visiblePageButton)) {
      return pauseDecision(visiblePageButton);
    }
    clearProgressProbe();
    if (!initialPlayDelayElapsed && !restartPending()) return playbackProbeMs;
    return point(visiblePageButton);
  }

  // A compact/background WebView may keep the page control in the DOM but
  // outside the rendered viewport. It can still prove playback, but only after
  // the media clock actually advances. A repeated zero-second stall is toggled
  // back to Play so the next scheduler pass can issue a fresh trusted click.
  if (pageButtons.some(isPauseControl)) {
    resetTransitionRetry();
    const pagePause = pageButtons.find(isPauseControl) || null;
    return pagePause ? pauseDecision(pagePause) : playbackProbeMs;
  }

  // Some Spotify responsive layouts omit the target-page button entirely.
  // Global Pause remains confirmation-only during normal playback. A global
  // Play becomes eligible only after this target itself was proven stalled at
  // zero seconds, and only while now-playing identity still matches the target.
  const playerButtons = cachedButtons(
      'playerButtons', 'button[data-testid="control-button-playpause"]');
  const playerPause = playerButtons.find(isPauseControl) || null;
  if (playerPause && currentTrackMatchesTarget()) {
    resetTransitionRetry();
    return pauseDecision(playerPause);
  }
  const playerPlay = playerButtons.find(button => isPlayControl(button) && visible(button)) || null;
  if (restartPending() && playerPlay && currentTrackMatchesTarget()) {
    resetTransitionRetry();
    clearProgressProbe();
    return point(playerPlay);
  }

  clearProgressProbe();
  // If Spotify already exposes a global player control but its identity does
  // not prove this target, do not treat that as a missing-control transition.
  // Returning null preserves the existing wrong-track/global-Play rejection.
  if (playerButtons.length > 0) return null;
  return nextTransitionRetryDelay();
})()
)JS";

const std::wstring kSpotifyScopedTrackReconcileScriptStorage =
    std::wstring(kSpotifyScopedTrackReconcileScriptPart1) + L"\n" +
    kSpotifyScopedTrackReconcileScriptPart2 + L"\n" +
    kSpotifyScopedTrackReconcileErrorRecoveryScript + L"\n" +
    kSpotifyScopedTrackReconcileScriptPart3;
const wchar_t* const kSpotifyScopedTrackReconcileScript =
    kSpotifyScopedTrackReconcileScriptStorage.c_str();

}  // namespace
}  // namespace hp
