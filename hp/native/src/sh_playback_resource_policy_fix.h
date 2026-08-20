#pragma once
#include "sh_startup_resource_reduction_policy_fix.h"
#include "stationhead_native_stats.h"

namespace hp {

// Stationhead's public shell, authenticated route, playback controls, feature
// configuration, and telemetry are loaded through one evolving module/API graph.
// Keep the final playback WebView boundary fail-open: play-count acquisition now
// runs inside the already-authenticated primary WebView and does not add native
// request filters, response substitution, or a second HTTP client.
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

  // Clear only Chromium's HTTP cache once per newly created playback controller.
  // Cookies and DOM storage remain intact, so Stationhead login, Spotify auth,
  // and the WebView-owned statistics request all reuse the live browser session.
  webview->CallDevToolsProtocolMethod(
      L"Network.clearBrowserCache", L"{}", nullptr);
}

// Restore the proven page-owned acquisition shape: Primary's native Tick owns
// the five-minute cadence, while this script performs exactly one authenticated
// streakStats request inside that same logged-in WebView. There is no internal
// second throttle and no native replay of Authorization/Cookie headers.
inline std::wstring StationheadPrimaryWebViewStatsScript(int channelId) {
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
      post({ type: 'stationhead-play-stats-auth-failed', status: response.status });
      return null;
    }
    if (!response.ok) throw new Error('http-' + response.status);
    return response.json();
  }).then(data => {
    if (data) {
      post({ type: 'stationhead-play-stats', data, source: 'authenticated-api' });
    }
  }).catch(error => {
    post({
      type: 'stationhead-play-stats-error',
      error: String(error?.message || error),
    });
  });
  return true;
})()
)JS";
  return script.str();
}

}  // namespace hp

#undef ApplyStationheadResourceBlocking
#define ApplyStationheadResourceBlocking ApplyStationheadResourceBlockingPlaybackSafe

// Keep the shared native five-minute scheduler active. Only the request executor
// changes: it now calls the authenticated primary WebView instead of WinHTTP.
#undef StationheadApiPlayStatsScript
#define StationheadApiPlayStatsScript StationheadPrimaryWebViewStatsScript

#include "sh_stats_webview_message_policy_fix.h"
