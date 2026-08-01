#pragma once
#include "common.h"
#include "sh_data_acquisition_resource_policy_fix.h"
#include "sh_stats_july23_baseline_policy_fix.h"
#include "sh_startup_resource_reduction_policy_fix.h"
#include "sh_playback_resource_policy_fix.h"

namespace hp {

// The two Stationhead WebViews stay on their dedicated station pages. Media
// boundary events no longer trigger navigation; the native layer alternates
// only the audible A/B profile every two minutes.
inline std::wstring StationheadTrackBoundaryScript(const wchar_t*) {
  return {};
}

}  // namespace hp

// sh_webview.cpp still accepts the legacy string message names for compatibility
// with an already-running page during an in-place update. Compile those callbacks
// as no-ops so page events cannot initiate a reload.
#define HandleTrackEnded(...) ((void)0)
