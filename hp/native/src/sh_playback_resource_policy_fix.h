#pragma once
#include "sh_startup_resource_reduction_policy_fix.h"

namespace hp {

// Keep Stationhead's playback boundary fail-open. Statistics acquisition is
// supplied by the later July 19 policy and must not attach a native request or
// response observer here.
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

}  // namespace hp

#undef ApplyStationheadResourceBlocking
#define ApplyStationheadResourceBlocking ApplyStationheadResourceBlockingPlaybackSafe
