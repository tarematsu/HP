#pragma once
#include "common.h"

namespace hp {

// Periodic Stationhead refresh is owned entirely by the native 55-minute clock.
// Keep the historical composition point as an empty script so existing startup
// assembly remains stable without observing media-ended or track-transition
// events in the page.
inline std::wstring StationheadTrackBoundaryScript(const wchar_t*) {
  return {};
}

}  // namespace hp

// sh_webview.cpp still accepts the legacy string message names for compatibility
// with an already-running page during an in-place update. Compile those callbacks
// as no-ops: neither a page event nor a forged trusted-origin message may start a
// reload. Only the native elapsed-time policy can navigate the playback WebView.
#define HandleTrackEnded(...) ((void)0)
