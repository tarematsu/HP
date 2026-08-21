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

  // Clear only Chromium's HTTP cache once per newly created playback controller.
  // Cookies and DOM storage remain intact, so Stationhead login and Spotify
  // authorization survive the reset. Do not install request substitution, URL
  // blocking, or statistics observers at this boundary.
  webview->CallDevToolsProtocolMethod(
      L"Network.clearBrowserCache", L"{}", nullptr);
}

// PollDailyPlayStats() is compiled in sh.cpp. sh.cpp receives this header through
// the precompiled-header chain, whereas the later sh_track_boundary_script.h is
// included only by sh_webview.cpp. Keep the actual periodic request at this
// shared compile boundary so the code that runs every five minutes cannot fall
// back to the older Authorization-required generator.
inline std::wstring StationheadPrimaryPlayStatsScript(int channelId) {
  std::wostringstream script;
  script << LR"JS(
(() => {
  const post = message => {
    try { window.chrome?.webview?.postMessage(message); } catch (_) {}
  };
  const captured = window.__homepanelStationheadAuthHeaders;
  const requestHeaders = { accept: 'application/json' };
  if (captured?.authorization) Object.assign(requestHeaders, captured);
  const url = 'https://production1.stationhead.com/me/channel/)JS"
         << channelId << LR"JS(/streakStats';
  fetch(url, {
    method: 'GET',
    credentials: 'include',
    cache: 'no-store',
    headers: requestHeaders,
  }).then(async response => {
    if (response.status === 401) {
      if (captured?.authorization) {
        window.__homepanelStationheadRejectedAuthorization = captured.authorization;
        window.__homepanelStationheadAuthHeaders = null;
      }
      post({ type: 'stationhead-play-stats-auth-failed', status: response.status });
      return null;
    }
    if (response.status === 403) {
      post({ type: 'stationhead-play-stats-error', error: 'forbidden' });
      return null;
    }
    if (!response.ok) throw new Error('http-' + response.status);
    return response.json();
  }).then(data => {
    if (data) post({ type: 'stationhead-play-stats', data, source: 'authenticated-api' });
  }).catch(error => {
    post({ type: 'stationhead-play-stats-error', error: String(error?.message || error) });
  });
  return true;
})()
)JS";
  return script.str();
}

}  // namespace hp

#undef ApplyStationheadResourceBlocking
#define ApplyStationheadResourceBlocking ApplyStationheadResourceBlockingPlaybackSafe

// This macro is consumed by StationheadPlayer::PollDailyPlayStats() in sh.cpp.
// Define it at the PCH-visible boundary instead of only in sh_webview.cpp.
#undef StationheadApiPlayStatsScript
#define StationheadApiPlayStatsScript StationheadPrimaryPlayStatsScript
