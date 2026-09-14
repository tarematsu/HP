#pragma once
#include "sh_startup_resource_reduction_policy_fix.h"

namespace hp {

// Keep Stationhead's playback boundary fail-open. Statistics acquisition stays
// in the authenticated primary WebView and does not attach native request or
// response observers here.
inline void ApplyStationheadResourceBlockingPlaybackSafe(
    ICoreWebView2Environment* environment,
    ICoreWebView2* webview,
    const StationheadConfig& config,
    std::atomic<bool>& armed,
    EventRegistrationToken& token) {
  (void)config;
  (void)armed;
  (void)token;
  if (!environment || !webview) return;

  // Only the HTTP cache is cleared. Cookies and DOM storage remain intact so
  // the persistent Stationhead login profile is preserved across restarts.
  webview->CallDevToolsProtocolMethod(
      L"Network.clearBrowserCache", L"{}", nullptr);
}

// Restore PR #48's authenticated polling behavior. The three generation fields
// are compatibility metadata for the current WebMessage parser only; they do
// not participate in request/auth decisions. The request itself retains PR48's
// single readiness signal (captured Authorization), retry behavior, ten-minute
// success quiet period, and 401/403 invalidation semantics.
inline std::wstring StationheadPrimaryPlayStatsScript(int channelId) {
  std::wostringstream script;
  script << LR"JS(
(() => {
  const post = message => {
    try { window.chrome?.webview?.postMessage(message); } catch (_) {}
  };
  const headers = window.__homepanelStationheadAuthHeaders;
  if (!headers?.authorization) {
    post({ type: 'stationhead-play-stats-error', error: 'no-auth-header' });
    return false;
  }
  const lastSuccessAt = Number(window.__homepanelStationheadPlayStatsSuccessAt || 0);
  if (lastSuccessAt > 0 && Date.now() - lastSuccessAt < 10 * 60 * 1000) {
    return false;
  }
  const requestId = Number(window.__homepanelStationheadStatsRequestId || 0) + 1;
  window.__homepanelStationheadStatsRequestId = requestId;
  const url = 'https://production1.stationhead.com/me/channel/)JS"
         << channelId << LR"JS(/streakStats';
  fetch(url, {
    method: 'GET',
    credentials: 'include',
    cache: 'no-store',
    headers: Object.assign({ accept: 'application/json' }, headers),
  }).then(async response => {
    if (response.status === 401 || response.status === 403) {
      window.__homepanelStationheadRejectedAuthorization = headers.authorization;
      window.__homepanelStationheadAuthHeaders = null;
      post({
        type: 'stationhead-play-stats-auth-failed',
        status: response.status,
        auth_generation: 1,
      });
      return null;
    }
    if (!response.ok) throw new Error('http-' + response.status);
    return response.json();
  }).then(data => {
    if (data) {
      window.__homepanelStationheadPlayStatsSuccessAt = Date.now();
      post({
        type: 'stationhead-play-stats',
        data,
        source: 'authenticated-api',
        request_id: requestId,
        document_generation: 1,
        auth_generation: 1,
      });
    }
  }).catch(error => {
    post({ type: 'stationhead-play-stats-error', error: String(error?.message || error) });
  });
  return true;
})()
)JS";
  return script.str();
}

// Suppress paint-heavy visual effects and presentation-only social/statistics
// surfaces without hiding the controls that native login/start detection needs.
// The semantic CSS is supplemented by a bounded set of startup passes that tag
// Stationhead UI whose production DOM has no stable test-id. There is no
// persistent MutationObserver or animation-frame loop, so the reduction logic
// itself cannot become a steady-state CPU cost.
// Account/avatar images and CSS backgrounds stay available because Stationhead's
// login settlement heuristics use them as authentication signals.
inline std::wstring StationheadRenderReductionScript() {
  static constexpr wchar_t kScript[] = LR"JS(
(() => {
  const host = String(location.hostname || '').toLowerCase();
  if (host !== 'stationhead.com' && !host.endsWith('.stationhead.com')) return;
  const styleId = '__homepanelStationheadRenderReduction';
  const pruneClass = '__homepanelStationheadPruned';
  let pruningScheduled = false;

  const normalize = value => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const controlSelector = "button,[role='button'],a,input[type='button'],input[type='submit']";
  const protectedControlText = text =>
      text.includes('start listening') ||
      text === 'log in' || text === 'login' || text === 'sign in' ||
      text.includes('connect spotify') || text.includes('continue with spotify');
  const hasProtectedControl = root => {
    if (!root?.querySelectorAll) return false;
    for (const control of root.querySelectorAll(controlSelector)) {
      const text = normalize(control.textContent || control.getAttribute('aria-label') || control.value);
      if (protectedControlText(text)) return true;
    }
    return false;
  };
  const hide = element => {
    if (!element?.classList || hasProtectedControl(element)) return false;
    element.classList.add(pruneClass);
    return true;
  };
  const compactAncestor = (element, widthRatio, heightRatio) => {
    let node = element;
    let candidate = element;
    for (let depth = 0; depth < 5 && node?.parentElement; depth += 1) {
      node = node.parentElement;
      if (node === document.body || node === document.documentElement || hasProtectedControl(node)) break;
      const rect = node.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0 &&
          rect.width <= innerWidth * widthRatio && rect.height <= innerHeight * heightRatio) {
        candidate = node;
      }
    }
    return candidate;
  };

  const prune = () => {
    if (!document.body) return;

    // Action rows shown in the station menu. Match rendered text because the
    // production site currently does not expose stable test ids for all rows.
    const actionLabels = [
      'threads', 'following', 'request song', 'ask to speak',
      'share', 'get the app', 'all access'
    ];
    for (const control of document.querySelectorAll(controlSelector)) {
      const text = normalize(control.textContent || control.getAttribute('aria-label') || control.value);
      if (!text || protectedControlText(text)) continue;
      if (actionLabels.some(label => text === label || text.startsWith(label + ' '))) {
        hide(compactAncestor(control, 0.72, 0.16));
      }
    }

    // The current chat rail is easiest to identify from its message composer.
    // Remove the whole right rail rather than every continuously changing chat
    // row, so new messages do not create recurring cleanup work.
    for (const input of document.querySelectorAll("input,textarea,[contenteditable='true']")) {
      const placeholder = normalize(input.getAttribute('placeholder'));
      if (!placeholder.includes('send a message')) continue;
      let node = input;
      let candidate = null;
      for (let depth = 0; depth < 9 && node?.parentElement; depth += 1) {
        node = node.parentElement;
        if (node === document.body || node === document.documentElement || hasProtectedControl(node)) break;
        const rect = node.getBoundingClientRect();
        if (rect.width >= innerWidth * 0.20 && rect.width <= innerWidth * 0.60 &&
            rect.height >= innerHeight * 0.32 && rect.right >= innerWidth * 0.70) {
          candidate = node;
        }
      }
      if (candidate) hide(candidate);
    }

    // Hide the station footer/miniplayer once it can be recognized without
    // touching the audio element itself.
    for (const element of document.querySelectorAll('span,p,small')) {
      const text = normalize(element.textContent);
      if (!text.includes("i'm on stationhead")) continue;
      let node = element;
      let candidate = null;
      for (let depth = 0; depth < 7 && node?.parentElement; depth += 1) {
        node = node.parentElement;
        if (node === document.body || node === document.documentElement || hasProtectedControl(node)) break;
        const rect = node.getBoundingClientRect();
        if (rect.width >= innerWidth * 0.55 && rect.height <= innerHeight * 0.25 &&
            rect.bottom >= innerHeight * 0.65) {
          candidate = node;
        }
      }
      if (candidate) hide(candidate);
    }

    // Small badges that are still visible in the production layout.
    for (const element of document.querySelectorAll('span,p,small')) {
      const text = normalize(element.textContent);
      if (text === 'on air' || text.startsWith('syndicating on ')) {
        hide(compactAncestor(element, 0.55, 0.18));
      }
    }

    // Header branding and footer chrome are presentation-only. Preserve either
    // container automatically when it contains a required login/start control.
    for (const element of document.querySelectorAll('header,footer')) hide(element);
  };

  const schedulePruning = () => {
    if (pruningScheduled) return;
    pruningScheduled = true;
    for (const delay of [0, 500, 1500, 4000, 8000, 15000]) {
      setTimeout(prune, delay);
    }
  };

  const install = () => {
    if (document.getElementById(styleId)) {
      schedulePruning();
      return true;
    }
    const root = document.head || document.documentElement;
    if (!root) return false;
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      *, *::before, *::after {
        animation: none !important;
        transition: none !important;
        scroll-behavior: auto !important;
        box-shadow: none !important;
        filter: none !important;
        backdrop-filter: none !important;
        text-shadow: none !important;
        will-change: auto !important;
        view-transition-name: none !important;
      }
      .${pruneClass},
      video, canvas, svg[aria-hidden='true'],
      marquee,
      [data-testid*='chat' i], [id*='chat' i], [class*='chat' i], [aria-label*='chat' i],
      [data-testid*='comment' i], [id*='comment' i], [class*='comment' i], [aria-label*='comment' i],
      [data-testid*='thread' i], [id*='thread' i], [class*='thread' i], [aria-label*='thread' i],
      [data-testid*='gift' i], [id*='gift' i], [aria-label*='gift' i],
      [data-testid*='reaction' i], [id*='reaction' i], [aria-label*='reaction' i],
      [data-testid*='emoji' i], [id*='emoji' i], [aria-label*='emoji' i],
      [data-testid*='tip' i], [id*='tip' i], [aria-label*='tip' i],
      [data-testid*='tipping' i], [id*='tipping' i], [aria-label*='tipping' i],
      [data-testid*='share' i], [id*='share' i], [aria-label*='share' i],
      [data-testid*='invite' i], [id*='invite' i], [aria-label*='invite' i],
      [data-testid*='social' i], [id*='social' i], [aria-label*='social' i],
      [data-testid*='listener' i], [id*='listener' i], [aria-label*='listener' i],
      [data-testid*='audience' i], [id*='audience' i], [aria-label*='audience' i],
      [data-testid*='leaderboard' i], [id*='leaderboard' i], [aria-label*='leaderboard' i],
      [data-testid*='ranking' i], [id*='ranking' i], [aria-label*='ranking' i],
      [data-testid*='rank-' i], [id*='rank-' i], [aria-label*='rank ' i],
      [data-testid*='stats' i], [id*='stats' i], [aria-label*='stats' i],
      [data-testid*='streak' i], [id*='streak' i], [aria-label*='streak' i],
      [data-testid*='play-count' i], [id*='play-count' i], [aria-label*='play count' i],
      [data-testid*='playcount' i], [id*='playcount' i], [aria-label*='total plays' i],
      [data-testid*='total-plays' i], [id*='total-plays' i],
      [data-testid*='totalplays' i], [id*='totalplays' i],
      [data-testid*='now-playing' i], [id*='now-playing' i], [class*='now-playing' i],
      [data-testid*='track-card' i], [id*='track-card' i], [class*='track-card' i],
      [data-testid*='current-track' i], [id*='current-track' i], [class*='current-track' i],
      [data-testid*='current-song' i], [id*='current-song' i], [class*='current-song' i],
      [data-testid*='song-card' i], [id*='song-card' i], [class*='song-card' i],
      [data-testid*='waveform' i], [id*='waveform' i], [class*='waveform' i], [aria-label*='waveform' i],
      [data-testid*='visualizer' i], [id*='visualizer' i], [class*='visualizer' i], [aria-label*='visualizer' i],
      [data-testid*='equalizer' i], [id*='equalizer' i], [class*='equalizer' i], [aria-label*='equalizer' i],
      [data-testid*='spectrum' i], [id*='spectrum' i], [class*='spectrum' i], [aria-label*='spectrum' i],
      [data-testid*='lottie' i], [id*='lottie' i], [class*='lottie' i],
      [data-testid*='confetti' i], [id*='confetti' i], [class*='confetti' i],
      [data-testid*='sparkle' i], [id*='sparkle' i], [class*='sparkle' i],
      [data-testid*='marquee' i], [id*='marquee' i], [class*='marquee' i],
      [data-testid*='ticker' i], [id*='ticker' i], [class*='ticker' i],
      a[href*='/chat' i], a[href*='/leaderboard' i] {
        display: none !important;
        visibility: hidden !important;
        pointer-events: none !important;
        content-visibility: hidden !important;
      }
    `;
    root.appendChild(style);
    schedulePruning();
    return true;
  };
  if (!install()) {
    document.addEventListener('DOMContentLoaded', install, { once: true });
  }
  return true;
})()
)JS";
  return kScript;
}

inline std::wstring StationheadAutoplayScriptRenderReduced(
    const wchar_t* globalName,
    const wchar_t* messagePrefix) {
  return StationheadAutoplayScript(globalName, messagePrefix) + L"\n" +
         StationheadRenderReductionScript();
}

}  // namespace hp

#undef ApplyStationheadResourceBlocking
#define ApplyStationheadResourceBlocking ApplyStationheadResourceBlockingPlaybackSafe

#undef StationheadApiPlayStatsScript
#define StationheadApiPlayStatsScript StationheadPrimaryPlayStatsScript

#undef StationheadAutoplayScript
#define StationheadAutoplayScript StationheadAutoplayScriptRenderReduced
