#pragma once

namespace hp {

// Audio/login state detection for the single Stationhead document runtime.
// This is a source fragment, not an independent script: compact_runtime appends
// onboarding, recovery and lifecycle fragments before closing the same IIFE.
inline std::wstring_view StationheadRuntimeInteractionFragment() noexcept {
  static constexpr std::wstring_view kFragment = LR"JS(
(() => {
  const host = String(location.hostname || '').toLowerCase();
  if ((host !== 'stationhead.com' && !host.endsWith('.stationhead.com')) ||
      window.top !== window) return;

  const guardName = '{{GLOBAL}}CompactRuntime';
  if (window[guardName]) return;
  window[guardName] = true;

  const webview = window.chrome?.webview;
  const nativeTimeout = window.setTimeout.bind(window);
  const nativeClearTimeout = window.clearTimeout.bind(window);
  const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
  const controlSelector =
    "button,[role='button'],a,input[type='button'],input[type='submit']," +
    "[aria-label],[data-testid],[tabindex]";
  const credentialSelector =
    "input[type='password'],input[type='email'],input[autocomplete='username']," +
    "input[autocomplete='current-password']";
  const blockingShellSelector =
    "form,[role='dialog'],[aria-modal='true'],[data-modal]," +
    "[class*='modal'],[class*='dialog']";
  const loginPattern =
    /^(log\s*in|sign\s*in|login|ログイン|サインイン)(?:\s+.*)?$/i;
  const accountPattern =
    /\b(account|profile|avatar|user\s+menu|my\s+profile)\b|アカウント|プロフィール/i;

  let pageActive = true;
  let eventTimer = 0;
  let authReadyTimer = 0;
  let lastAudio = null;
  let lastBlocking = null;
  let playbackEstablished = false;

  const postText = suffix => {
    try { webview?.postMessage?.('{{PREFIX}}-' + suffix); } catch (_) {}
  };
  const post = message => {
    try { webview?.postMessage?.(message); } catch (_) {}
  };
  const visible = element => {
    if (!(element instanceof Element) || !element.isConnected ||
        element.disabled || element.getAttribute('aria-hidden') === 'true' ||
        element.getAttribute('aria-disabled') === 'true') return false;
    const rect = element.getBoundingClientRect?.();
    if (!rect || rect.width <= 2 || rect.height <= 2 || rect.right <= 0 ||
        rect.bottom <= 0 || rect.left >= innerWidth || rect.top >= innerHeight) {
      return false;
    }
    const style = getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden' &&
      Number(style.opacity || 1) > 0 && style.pointerEvents !== 'none';
  };
  const labelOf = element => normalize([
    element?.getAttribute?.('aria-label'),
    element?.getAttribute?.('data-testid'),
    element?.getAttribute?.('title'),
    element?.getAttribute?.('alt'),
    element?.getAttribute?.('value'),
    element?.innerText,
    element?.textContent,
  ].filter(Boolean).join(' '));
  const playing = () => {
    if (typeof window.__homepanelAudioPlaying === 'boolean') {
      return window.__homepanelAudioPlaying;
    }
    if (navigator.mediaSession?.playbackState === 'playing') return true;
    // Avoid creating a temporary Array on every audio state event.
    for (const element of document.querySelectorAll('audio,video')) {
      if (!element.paused && !element.ended && element.readyState >= 2) {
        return true;
      }
    }
    return false;
  };
  const publishAudio = () => {
    const current = playing();
    if (current) playbackEstablished = true;
    if (current === lastAudio) return current;
    lastAudio = current;
    postText(current ? 'playing' : 'stopped');
    return current;
  };
  const loginRoute = () =>
    /(^|\/)(login|signin|sign-in|auth)(?:\/|[?#]|$)/i.test(
      String(location.pathname || ''));

  const accountVisible = (controls = document.querySelectorAll(controlSelector)) => {
    for (const element of controls) {
      // Avoid geometry and computed style for unrelated controls. Preserve
      // the avatar-descendant fallback and verify visibility before accepting.
      const href = String(element.getAttribute?.('href') || '').toLowerCase();
      const label = labelOf(element);
      if (!accountPattern.test(label) &&
          !/(^|\/)(account|profile|settings|user)(?:\/|[?#]|$)/i.test(href) &&
          !element.querySelector?.(
            "[data-testid*='avatar' i],[data-testid*='profile' i],[class*='avatar' i]")) continue;
      if (visible(element)) return true;
    }
    return false;
  };
  const blockingLogin = (authenticated, recoverableAction = false, controls = null) => {
    if (loginRoute()) return true;
    for (const input of document.querySelectorAll(credentialSelector)) {
      if (visible(input)) return true;
    }
    // An explicit recoverable action has already been found. A separate Log in
    // link in the same dialog must not suppress it; login routes and visible
    // credential fields above remain hard stops.
    if (recoverableAction) return false;
    for (const element of controls || document.querySelectorAll(controlSelector)) {
      const label = labelOf(element);
      const href = String(element.getAttribute?.('href') || '').toLowerCase();
      if (!loginPattern.test(label) &&
          !/(^|\/)(login|signin|sign-in)(?:\/|[?#]|$)/i.test(href)) continue;
      if (!visible(element)) continue;
      const shell = element.closest?.(blockingShellSelector);
      if (!authenticated || (shell && visible(shell))) return true;
    }
    return false;
  };
  const cancelAuthReady = () => {
    if (!authReadyTimer) return;
    nativeClearTimeout(authReadyTimer);
    authReadyTimer = 0;
  };
  const publishAuth = (knownAudio = null) => {
    if (!pageActive || !document.body) return;
    if (publishRecoverableOnboarding()) return;
    // Reuse one fresh control snapshot for both auth checks. Recoverable
    // onboarding runs first and may update the page's playback-only CSS;
    // never cache controls across events or the delayed authorization check.
    const controls = document.querySelectorAll(controlSelector);
    // Lifecycle just checked the audio state for this same event. Avoid a
    // second audio/video query (and repeated mediaSession access) in the
    // common account-absent path; standalone auth probes still query live.
    const authenticated = accountVisible(controls) ||
      (knownAudio === null ? playing() : knownAudio);
    const blocking = blockingLogin(authenticated, false, controls);
    if (blocking) {
      cancelAuthReady();
      window.__homepanelStationheadBlockingLoginVisible = true;
      if (lastBlocking !== true) {
        lastBlocking = true;
        const authorization = window.__homepanelStationheadAuthHeaders?.authorization || '';
        if (authorization) {
          window.__homepanelStationheadRejectedAuthorization = authorization;
        }
        window.__homepanelStationheadAuthHeaders = null;
        postText('login-required');
      }
      return;
    }
    if (!authenticated || lastBlocking === false || authReadyTimer) return;
    authReadyTimer = nativeTimeout(() => {
      authReadyTimer = 0;
      if (!pageActive || !document.body) return;
      const controls = document.querySelectorAll(controlSelector);
      const stillAuthenticated = accountVisible(controls) || playing();
      if (!stillAuthenticated || blockingLogin(stillAuthenticated, false, controls)) return;
      lastBlocking = false;
      window.__homepanelStationheadBlockingLoginVisible = false;
      post({ type: 'stationhead-auth-ready', source: 'compact-runtime' });
    }, 3000);
  };
)JS";
  return kFragment;
}

}  // namespace hp
