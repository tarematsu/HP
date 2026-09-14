#pragma once

#include "sh_render_reduction_policy.h"
#include "sh_room_ui_reduction_policy.h"

namespace hp {

// One document-start runtime for Stationhead. Playback start is driven by the
// existing native Tick()/AttemptNativeStartClick path, so this script only owns
// cheap page events: fallback audio state, login surface edges and a bounded
// blank-page recovery check. It intentionally has no MutationObserver,
// setInterval, animation-frame loop or recurring DOM scan.
inline std::wstring StationheadCompactRuntimeScript(
    const wchar_t* globalName,
    const wchar_t* messagePrefix) {
  static constexpr wchar_t kTemplate[] = LR"JS(
(() => {
  const host = String(location.hostname || '').toLowerCase();
  if ((host !== 'stationhead.com' && !host.endsWith('.stationhead.com')) ||
      window.top !== window) return;

  const guardName = '{{GLOBAL}}CompactRuntime';
  if (window[guardName]) return;
  window[guardName] = true;

  // Disconnect observers left by an older in-place document before installing
  // the compact event-driven runtime.
  for (const key of [
    '__homepanelStationheadAudioOnlyUiObserver',
    '__homepanelStationheadVolumeObserver'
  ]) {
    try { window[key]?.disconnect?.(); } catch (_) {}
    window[key] = null;
  }

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
  const serviceConnectPattern = /^connect\s+music$/i;

  let pageActive = true;
  let eventTimer = 0;
  let authReadyTimer = 0;
  let blankTimer = 0;
  let blankConfirmTimer = 0;
  let lastAudio = null;
  let lastBlocking = null;

  const postText = suffix => {
    try { webview?.postMessage?.('{{PREFIX}}-' + suffix); } catch (_) {}
  };
  const post = message => {
    try { webview?.postMessage?.(message); } catch (_) {}
  };
  const visible = element => {
    if (!(element instanceof Element) || !element.isConnected ||
        element.getAttribute('aria-hidden') === 'true' ||
        element.getAttribute('aria-disabled') === 'true' || element.disabled) {
      return false;
    }
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
    return Array.from(document.querySelectorAll('audio,video')).some(element =>
      !element.paused && !element.ended && element.readyState >= 2);
  };
  const publishAudio = () => {
    const current = playing();
    if (current === lastAudio) return current;
    lastAudio = current;
    postText(current ? 'playing' : 'stopped');
    return current;
  };

  const loginRoute = () =>
      /(^|\/)(login|signin|sign-in|auth)(?:\/|[?#]|$)/i.test(
          String(location.pathname || ''));
  const accountVisible = () => {
    for (const element of document.querySelectorAll(controlSelector)) {
      if (!visible(element)) continue;
      const label = labelOf(element);
      const href = String(element.getAttribute?.('href') || '').toLowerCase();
      if (accountPattern.test(label) ||
          /(^|\/)(account|profile|settings|user)(?:\/|[?#]|$)/i.test(href) ||
          element.querySelector?.("[data-testid*='avatar' i],[data-testid*='profile' i],[class*='avatar' i]")) {
        return true;
      }
    }
    return false;
  };
  const blockingLogin = authenticated => {
    if (loginRoute()) return true;
    for (const input of document.querySelectorAll(credentialSelector)) {
      if (visible(input)) return true;
    }
    for (const heading of document.querySelectorAll("h1,h2,h3,[role='heading']")) {
      if (visible(heading) && serviceConnectPattern.test(labelOf(heading))) return true;
    }
    for (const element of document.querySelectorAll(controlSelector)) {
      if (!visible(element)) continue;
      const label = labelOf(element);
      const href = String(element.getAttribute?.('href') || '').toLowerCase();
      if (!loginPattern.test(label) &&
          !/(^|\/)(login|signin|sign-in)(?:\/|[?#]|$)/i.test(href)) {
        continue;
      }
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
  const publishAuth = () => {
    if (!pageActive || !document.body) return;
    const authenticated = accountVisible() || playing();
    const blocking = blockingLogin(authenticated);
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
      const stillAuthenticated = accountVisible() || playing();
      if (!stillAuthenticated || blockingLogin(stillAuthenticated)) return;
      lastBlocking = false;
      window.__homepanelStationheadBlockingLoginVisible = false;
      post({ type: 'stationhead-auth-ready', source: 'compact-runtime' });
    }, 3000);
  };

  const run = () => {
    if (!pageActive) return;
    publishAudio();
    publishAuth();
  };
  const schedule = (delay = 0) => {
    if (!pageActive || eventTimer) return;
    eventTimer = nativeTimeout(() => {
      eventTimer = 0;
      run();
    }, delay);
  };

  const blankReloadKey = '__homepanelStationheadCompactBlankReloadAt';
  const sparseBlankPage = () => {
    if (!pageActive || document.readyState !== 'complete' || !document.body ||
        playing() || blockingLogin(accountVisible())) return false;
    const text = normalize(document.body.innerText);
    if (text.length >= 48) return false;
    return !document.querySelector(
      "button,a,input,select,textarea,audio,video,[role='button'],[aria-label]");
  };
  const armBlankRecovery = () => {
    if (blankTimer) nativeClearTimeout(blankTimer);
    if (blankConfirmTimer) nativeClearTimeout(blankConfirmTimer);
    blankTimer = nativeTimeout(() => {
      blankTimer = 0;
      if (!sparseBlankPage()) return;
      blankConfirmTimer = nativeTimeout(() => {
        blankConfirmTimer = 0;
        if (!sparseBlankPage()) return;
        let lastReload = 0;
        try { lastReload = Number(sessionStorage.getItem(blankReloadKey) || 0); } catch (_) {}
        const now = Date.now();
        if (lastReload > 0 && now - lastReload < 120000) return;
        try { sessionStorage.setItem(blankReloadKey, String(now)); } catch (_) {}
        location.reload();
      }, 15000);
    }, 30000);
  };

  const onInteractiveEvent = () => {
    schedule(0);
    schedule(3000);
  };
  for (const eventName of [
      'play', 'playing', 'canplay', 'pause', 'ended', 'stalled', 'waiting', 'error']) {
    document.addEventListener(eventName, schedule, true);
  }
  document.addEventListener('click', onInteractiveEvent, true);
  document.addEventListener('submit', onInteractiveEvent, true);
  document.addEventListener('DOMContentLoaded', () => {
    run();
    armBlankRecovery();
  }, { once: true });
  window.addEventListener('load', () => {
    run();
    armBlankRecovery();
  }, { once: true });
  window.addEventListener('focus', schedule, true);
  window.addEventListener('popstate', schedule, true);
  window.addEventListener('hashchange', schedule, true);
  window.addEventListener('homepanel-stationhead-auth-ready', schedule, true);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) schedule(0);
  });
  window.addEventListener('pagehide', () => {
    pageActive = false;
    for (const timer of [eventTimer, authReadyTimer, blankTimer, blankConfirmTimer]) {
      if (timer) nativeClearTimeout(timer);
    }
    eventTimer = authReadyTimer = blankTimer = blankConfirmTimer = 0;
  }, true);
  window.addEventListener('pageshow', () => {
    pageActive = true;
    run();
    armBlankRecovery();
  }, true);

  run();
  armBlankRecovery();
})()
)JS";

  const auto replaceAll = [](std::wstring text,
                             std::wstring_view from,
                             std::wstring_view to) {
    for (size_t at = text.find(from); at != std::wstring::npos;
         at = text.find(from, at + to.size())) {
      text.replace(at, from.size(), to);
    }
    return text;
  };
  const std::wstring guard = globalName ? globalName : L"__homepanelStationhead";
  const std::wstring prefix = messagePrefix ? messagePrefix : L"stationhead";
  return replaceAll(replaceAll(kTemplate, L"{{GLOBAL}}", guard),
                    L"{{PREFIX}}", prefix);
}

inline std::wstring BuildStationheadStartupScript(
    const wchar_t* globalName,
    const wchar_t* messagePrefix) {
  std::wstring script =
      StationheadCompactRuntimeScript(globalName, messagePrefix);
  script.push_back(L'\n');
  script.append(StationheadRenderReductionScript());
  script.push_back(L'\n');
  script.append(StationheadRoomUiReductionScript());
  return script;
}

}  // namespace hp

// One compatibility name remains at the sh_webview.cpp call site. No earlier
// policy header selects or wraps the effective startup implementation.
#undef StationheadAutoplayScript
#define StationheadAutoplayScript BuildStationheadStartupScript
