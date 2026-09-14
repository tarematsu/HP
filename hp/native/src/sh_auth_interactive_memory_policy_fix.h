#pragma once

namespace hp {
namespace stationhead_auth_memory_policy {

// Stationhead keeps both playback and authorization WebViews on WebView2's
// LOW memory target. Interactive foregrounding changes geometry/focus only;
// it no longer promotes the auth controller back to NORMAL.
inline constexpr COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL
    kInteractiveAuthMemoryTarget =
        COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW;

static_assert(kInteractiveAuthMemoryTarget ==
              COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW);

}  // namespace stationhead_auth_memory_policy
}  // namespace hp

#include "sh_auth_process_failure_policy_fix.h"
