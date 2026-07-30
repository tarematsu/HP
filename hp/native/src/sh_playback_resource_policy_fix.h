#pragma once
#include "sh_startup_resource_reduction_policy_fix.h"

namespace hp {

// Stationhead's public shell, authenticated route, playback controls, feature
// configuration, and telemetry are loaded through one evolving module/API graph.
// Native request substitution cannot reliably distinguish an optional request
// from a route-critical dependency across account flags and staged deployments.
// Keep the final playback WebView boundary completely fail-open and retain only
// Chromium's environment-level image/font policy.
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
  // authorization survive the reset. Do not install WebResourceRequested or CDP
  // URL blocking: a delayed module, feature flag, or authenticated API must never
  // be replaced by a synthetic response after the route shell has mounted.
  webview->CallDevToolsProtocolMethod(L"Network.enable", L"{}", nullptr);
  webview->CallDevToolsProtocolMethod(
      L"Network.clearBrowserCache", L"{}", nullptr);
}

}  // namespace hp

#undef ApplyStationheadResourceBlocking
#define ApplyStationheadResourceBlocking ApplyStationheadResourceBlockingPlaybackSafe
