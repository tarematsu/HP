#pragma once
#include "sh_data_acquisition_resource_policy_fix.h"

// The July 23 build used the generators and request policy directly exposed by
// sh_polling_policy.h. Later PCH layers changed auth validation, candidate
// rotation, secondary probing, and the final resource handler. Restore the
// complete stats execution boundary instead of restoring only two function
// names. Playback, native refresh handoff, and Start Listening automation remain
// on their current implementations.
#undef StationheadAuthCaptureScript
#undef StationheadApiPlayStatsScript
#undef StationheadAuthProbeScript
#undef ApplyStationheadResourceBlocking

namespace hp {

inline std::wstring StationheadAuthCaptureScriptJuly23Baseline() {
  return StationheadAuthCaptureScript();
}

inline std::wstring StationheadApiPlayStatsScriptJuly23Baseline(int channelId) {
  return StationheadApiPlayStatsScript(channelId);
}

inline std::wstring StationheadAuthProbeScriptJuly23Baseline(int channelId) {
  return StationheadAuthProbeScript(channelId);
}

inline void ApplyStationheadResourceBlockingJuly23Baseline(
    ICoreWebView2Environment* environment,
    ICoreWebView2* webview,
    const StationheadConfig& config,
    std::atomic<bool>& armed,
    EventRegistrationToken& token) {
  if (webview) {
    // ConfigureWebView calls this once for every newly created controller, both
    // at application startup and after a WebView rebuild. Clear only Chromium's
    // browser cache here. Cookies and DOM storage are intentionally untouched so
    // the Stationhead login survives the reset.
    webview->CallDevToolsProtocolMethod(L"Network.enable", L"{}", nullptr);
    webview->CallDevToolsProtocolMethod(
        L"Network.clearBrowserCache", L"{}", nullptr);
  }
  ApplyStationheadResourceBlocking(
      environment, webview, config, armed, token);
}

}  // namespace hp

#define StationheadAuthCaptureScript \
  StationheadAuthCaptureScriptJuly23Baseline
#define StationheadApiPlayStatsScript \
  StationheadApiPlayStatsScriptJuly23Baseline
#define StationheadAuthProbeScript \
  StationheadAuthProbeScriptJuly23Baseline
#define ApplyStationheadResourceBlocking \
  ApplyStationheadResourceBlockingJuly23Baseline
