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
// Account/avatar images and CSS backgrounds stay available because Stationhead's
// login settlement heuristics use them as authentication signals.
inline std::wstring StationheadRenderReductionScript() {
  static constexpr wchar_t kScript[] = LR"JS(
(() => {
  const host = String(location.hostname || '').toLowerCase();
  if (host !== 'stationhead.com' && !host.endsWith('.stationhead.com')) return;
  const styleId = '__homepanelStationheadRenderReduction';
  const install = () => {
    if (document.getElementById(styleId)) return true;
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
      }
      video, canvas, svg[aria-hidden='true'],
      [data-testid*='chat' i], [id*='chat' i], [aria-label*='chat' i],
      [data-testid*='comment' i], [id*='comment' i], [aria-label*='comment' i],
      [data-testid*='gift' i], [id*='gift' i], [aria-label*='gift' i],
      [data-testid*='reaction' i], [id*='reaction' i], [aria-label*='reaction' i],
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
      a[href*='/chat' i], a[href*='/leaderboard' i] {
        display: none !important;
        visibility: hidden !important;
        pointer-events: none !important;
        content-visibility: hidden !important;
      }
    `;
    root.appendChild(style);
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
