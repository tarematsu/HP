#pragma once
#include "common.h"
#include "sh_data_acquisition_resource_policy_fix.h"
#include "sh_startup_resource_reduction_policy_fix.h"
#include "sh_playback_resource_policy_fix.h"
#include "sh_startup_dom_batch_policy_fix.h"

namespace hp {

// Periodic Stationhead refresh is owned entirely by the native role-specific
// clock: Window A uses 55 minutes and Window B uses 56 minutes. Keep the
// historical composition point as an empty script without observing media-ended
// or track-transition events in the page.
inline std::wstring StationheadTrackBoundaryScript(const wchar_t*) {
  return {};
}

}  // namespace hp

// sh_webview.cpp still accepts the legacy string message names for compatibility
// with an already-running page during an in-place update. Compile those callbacks
// as no-ops: neither a page event nor a forged trusted-origin message may start a
// reload. Only the native elapsed-time policy can navigate the playback WebView.
#define HandleTrackEnded(...) ((void)0)
