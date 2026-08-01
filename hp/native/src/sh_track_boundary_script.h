#pragma once
#include "common.h"
#include "sh_data_acquisition_resource_policy_fix.h"
#include "sh_stats_july23_baseline_policy_fix.h"
#include "sh_startup_resource_reduction_policy_fix.h"
#include "sh_playback_resource_policy_fix.h"

namespace hp {

// Media boundaries never initiate navigation. Window A changes stations at
// each wall-clock minute :00 and Window B changes stations at :30 instead.
inline std::wstring StationheadTrackBoundaryScript(const wchar_t*) {
  return {};
}

}  // namespace hp

// Keep legacy trusted-origin track-ended messages harmless during an in-place
// update. Only the half-minute clock rotation may navigate a player.
#define HandleTrackEnded(...) ((void)0)
