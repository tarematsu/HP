#pragma once
#include "common.h"
#include "sh_data_acquisition_resource_policy_fix.h"
#include "sh_startup_resource_reduction_policy_fix.h"
#include "sh_playback_resource_policy_fix.h"
#include "sh_playback_visibility.h"

namespace hp {

// Native response observation owns play-count credentials. Reuse the existing
// first document-start registration slot only for login-state settlement; do
// not restore the legacy fetch/XHR credential wrappers.
inline std::wstring StationheadLoginSettlementScript() {
  static constexpr wchar_t kScript[] = LR"JS(
(() => {
  const host = String(location.hostname || '').toLowerCase();
  if ((host !== 'stationhead.com' && !host.endsWith('.stationhead.com')) ||
      window.top !== window || window.__homepanelStationheadLoginSettlement) {
    return;
  }
  const webview = window.chrome?.webview;
  if (!webview || typeof webview.postMessage !== 'function') return;
  window.__homepanelStationheadLoginSettlement = true;

  // This script is registered before the normal Stationhead startup script.
  // Keep WebView2's original native bridge so the later runtime wrapper cannot
  // swallow the one positive "login is complete" notification below.
  const nativePost = webview.postMessage.bind(webview);
  const nativeTimeout = window.setTimeout.bind(window);
  const nativeClearTimeout = window.clearTimeout.bind(window);
  const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
  const accountPattern =
      /\b(account|profile|avatar|user\s+menu|my\s+profile)\b|アカウント|プロフィール/i;
  const loginPattern =
      /^(log\s*in|sign\s*in|login|ログイン|サインイン)(?:\s+.*)?$/i;
  const serviceConnectPattern = /^connect\s+music$/i;
  const controlSelector =
      "button,[role='button'],a,input[type='button'],input[type='submit']," +
      "[aria-label],[data-testid],[tabindex]";
  const credentialSelector =
      "input[type='password'],input[type='email'],input[autocomplete='username']," +
      "input[autocomplete='current-password']";
  const headingSelector = "h1,h2,h3,[role='heading']";
  const blockingShellSelector =
      "form,[role='dialog'],[aria-modal='true'],[data-modal]," +
      "[class*='modal'],[class*='dialog']";

  let pageActive = true;
  let timer = 0;
  let accountSince = 0;
  let accountReported = false;

  const visible = element => {
    if (!(element instanceof Element) || !element.isConnected ||
        element.getAttribute('aria-hidden') === 'true') {
      return false;
    }
    const rect = element.getBoundingClientRect?.();
    if (!rect || rect.width <= 2 || rect.height <= 2 || rect.right <= 0 ||
        rect.bottom <= 0 || rect.left >= innerWidth || rect.top >= innerHeight) {
      return false;
    }
    const style = getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden' &&
      Number(style.opacity || 1) > 0;
  };

  const labelOf = element => normalize([
    element?.getAttribute?.('aria-label'),
    element?.getAttribute?.('data-testid'),
    element?.getAttribute?.('title'),
    element?.getAttribute?.('alt'),
    element?.getAttribute?.('name'),
    element?.innerText,
    element?.textContent,
  ].filter(Boolean).join(' '));

  const loginRoute = () =>
      /(^|\/)(login|signin|sign-in|auth)(?:\/|[?#]|$)/i.test(
          String(location.pathname || ''));

  const blockingLoginSurfaceVisible = authenticated => {
    if (loginRoute()) return true;
    for (const input of document.querySelectorAll(credentialSelector)) {
      if (visible(input)) return true;
    }
    for (const heading of document.querySelectorAll(headingSelector)) {
      if (visible(heading) && serviceConnectPattern.test(labelOf(heading))) {
        return true;
      }
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

  const accountNode = element => {
    if (!(element instanceof Element) || !visible(element)) return false;
    const label = labelOf(element);
    const href = String(element.getAttribute?.('href') || '').toLowerCase();
    if (accountPattern.test(label) ||
        /(^|\/)(account|profile|settings|user)(?:\/|[?#]|$)/i.test(href)) {
      return true;
    }
    if (element.matches?.('img,picture') ||
        element.querySelector?.("img,picture,[data-testid*='avatar' i]," +
          "[data-testid*='profile' i],[class*='avatar' i]," +
          "[aria-label*='avatar' i],[aria-label*='profile' i]," +
          "[aria-label*='account' i]")) {
      return true;
    }
    const style = getComputedStyle(element);
    return Boolean(style.backgroundImage && style.backgroundImage !== 'none');
  };

  const topRightAccountControl = () => {
    if (innerWidth < 80 || innerHeight < 60 ||
        typeof document.elementsFromPoint !== 'function') {
      return null;
    }
    const points = [
      [innerWidth - 24, 30],
      [innerWidth - 32, 30],
      [innerWidth - 40, 30],
      [innerWidth - 32, 42],
    ];
    for (const [x, y] of points) {
      for (const hit of document.elementsFromPoint(x, y)) {
        let element = hit instanceof Element ? hit : null;
        for (let depth = 0; element && depth < 6; depth += 1) {
          if (!visible(element)) {
            element = element.parentElement;
            continue;
          }
          const rect = element.getBoundingClientRect();
          if (rect.top < -4 || rect.top > 96 ||
              rect.right < innerWidth - 96 || rect.width > 128 ||
              rect.height > 128) {
            element = element.parentElement;
            continue;
          }
          const label = labelOf(element);
          // Signed-out Stationhead exposes an icon-only button labelled Menu at
          // this exact slot. The menu control by itself is not authenticated.
          if (/^menu$/i.test(label)) {
            element = element.parentElement;
            continue;
          }
          if (accountNode(element)) return element;
          element = element.parentElement;
        }
      }
    }
    return null;
  };

  const check = () => {
    if (!pageActive) return;
    const now = Date.now();
    const account = topRightAccountControl();
    if (blockingLoginSurfaceVisible(Boolean(account))) {
      accountSince = 0;
      accountReported = false;
      return;
    }
    if (!account) {
      accountSince = 0;
      accountReported = false;
      return;
    }
    if (!accountSince) accountSince = now;
    if (!accountReported && now - accountSince >= 3000) {
      accountReported = true;
      try { nativePost({ type: 'stationhead-auth-ready' }); } catch (_) {}
    }
  };

  const schedule = (delay = 1000) => {
    if (!pageActive || timer) return;
    timer = nativeTimeout(() => {
      timer = 0;
      check();
      schedule();
    }, delay);
  };

  window.addEventListener('pagehide', () => {
    pageActive = false;
    accountSince = 0;
    accountReported = false;
    if (timer) {
      nativeClearTimeout(timer);
      timer = 0;
    }
  }, true);
  window.addEventListener('pageshow', () => {
    pageActive = true;
    check();
    schedule(250);
  }, true);
  document.addEventListener('DOMContentLoaded', () => {
    check();
    schedule(250);
  }, { once: true });
  window.addEventListener('load', check, { once: true });
  check();
  schedule(250);
})()
)JS";
  return kScript;
}

// Reuse the legacy track-boundary message slots only as lightweight rendering
// hints. They never navigate. A finite media duration lets the page hide the
// background controller five seconds into playback, then reveal it ten seconds
// before the current track ends so the next-track transition can render
// normally. If duration is unavailable, rendering remains enabled.
inline std::wstring StationheadTrackBoundaryScript(const wchar_t* messagePrefix) {
  static constexpr wchar_t kTemplate[] = LR"JS(
(() => {
  const host = String(location.hostname || '').toLowerCase();
  if ((host !== 'stationhead.com' && !host.endsWith('.stationhead.com')) ||
      window.top !== window || window.__homepanelStationheadRenderLifecycle) {
    return;
  }
  const webview = window.chrome?.webview;
  if (!webview || typeof webview.postMessage !== 'function') return;
  window.__homepanelStationheadRenderLifecycle = true;

  const nativeTimeout = window.setTimeout.bind(window);
  const nativeClearTimeout = window.clearTimeout.bind(window);
  const hideDelayMs = 5000;
  const revealBeforeEndSeconds = 10;
  let hideTimer = 0;
  let renderSuppressed = false;
  let lastTrackKey = '';
  let lastTrackTime = -1;

  const post = suffix => {
    try { webview.postMessage('{{PREFIX}}-' + suffix); } catch (_) {}
  };
  const cancelHide = () => {
    if (!hideTimer) return;
    nativeClearTimeout(hideTimer);
    hideTimer = 0;
  };
  const reveal = () => {
    cancelHide();
    if (!renderSuppressed) return;
    renderSuppressed = false;
    post('track-ended');
  };
  const scheduleHide = () => {
    cancelHide();
    hideTimer = nativeTimeout(() => {
      hideTimer = 0;
      if (window.__homepanelAudioPlaying === false) return;
      renderSuppressed = true;
      post('track-boundary-retry');
    }, hideDelayMs);
  };
  const mediaKey = media => {
    const source = String(media.currentSrc || media.src || '');
    const duration = Number(media.duration);
    return source + '|' + (Number.isFinite(duration) ? duration.toFixed(3) : '');
  };
  const inspectMedia = media => {
    if (!(media instanceof HTMLMediaElement)) return;
    const duration = Number(media.duration);
    const currentTime = Number(media.currentTime);
    if (!Number.isFinite(duration) || duration <= 0 ||
        !Number.isFinite(currentTime) || currentTime < 0) {
      // Live/infinite streams have no reliable track boundary. Keep rendering
      // enabled rather than risking a hidden transition we cannot predict.
      reveal();
      lastTrackKey = '';
      lastTrackTime = -1;
      return;
    }

    const key = mediaKey(media);
    const restarted = key !== lastTrackKey ||
        (lastTrackTime >= 0 && currentTime + 2 < lastTrackTime);
    const remaining = Math.max(0, duration - currentTime);
    if (restarted) {
      reveal();
      lastTrackKey = key;
      if (remaining > revealBeforeEndSeconds) scheduleHide();
    }
    lastTrackTime = currentTime;

    if (remaining <= revealBeforeEndSeconds) {
      reveal();
    } else if (!renderSuppressed && !hideTimer) {
      scheduleHide();
    }
  };
  const handleMediaEvent = event => {
    const media = event.target;
    if (!(media instanceof HTMLMediaElement)) return;
    if (event.type === 'pause' || event.type === 'ended' ||
        event.type === 'error' || event.type === 'stalled' ||
        event.type === 'waiting' || event.type === 'emptied') {
      reveal();
      return;
    }
    inspectMedia(media);
  };

  for (const eventName of [
      'play', 'playing', 'canplay', 'loadedmetadata', 'durationchange',
      'timeupdate', 'pause', 'ended', 'error', 'stalled', 'waiting', 'emptied']) {
    document.addEventListener(eventName, handleMediaEvent, true);
  }
  window.addEventListener('pagehide', reveal, true);
  for (const media of document.querySelectorAll('audio,video')) inspectMedia(media);
})()
)JS";
  std::wstring script = kTemplate;
  static constexpr std::wstring_view marker = L"{{PREFIX}}";
  const std::wstring replacement = messagePrefix ? messagePrefix : L"stationhead";
  for (size_t at = script.find(marker); at != std::wstring::npos;
       at = script.find(marker, at + replacement.size())) {
    script.replace(at, marker.size(), replacement);
  }
  return script;
}

}  // namespace hp

// In sh_webview.cpp these legacy message handlers are now rendering hints only.
// retry=true means stable playback can stop rendering; retry=false restores the
// controller before the media boundary. No navigation or reload is initiated.
#define HandleTrackEnded(now_ms, suppress_rendering)                          \
  do {                                                                        \
    (void)(now_ms);                                                           \
    ::hp::SetStationheadPlaybackRenderingSuppressed(                          \
        IsSecondary(), controller_.Get(),                                     \
        static_cast<bool>(suppress_rendering));                               \
    LayoutControllers();                                                      \
  } while (false)

#undef StationheadAuthCaptureScript
#define StationheadAuthCaptureScript StationheadLoginSettlementScript

#include "sh_july19_stats_policy_fix.h"
