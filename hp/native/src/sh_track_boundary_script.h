#pragma once
#include "common.h"
#include "sh_data_acquisition_resource_policy_fix.h"
#include "sh_startup_resource_reduction_policy_fix.h"
#include "sh_playback_resource_policy_fix.h"

namespace hp {

// Native response observation owns play-count credentials. Keep the historical
// registration handshake in ConfigureWebView, but inject no fetch/XHR wrappers
// into Stationhead itself.
inline std::wstring StationheadAuthCaptureScriptDisabled() {
  return L"void 0";
}

// Media boundaries never initiate navigation. Window A uses the native
// 55-minute clock and Window B uses the native 54-minute clock instead.
inline std::wstring StationheadTrackBoundaryScript(const wchar_t*) {
  return {};
}

}  // namespace hp

// Keep legacy trusted-origin track-ended messages harmless during an in-place
// update. Only the independent elapsed-time refresh policy may reload a player.
#define HandleTrackEnded(...) ((void)0)

#undef StationheadAuthCaptureScript
#define StationheadAuthCaptureScript StationheadAuthCaptureScriptDisabled
