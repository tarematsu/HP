#pragma once
#include "common.h"

namespace hp {

// A dedicated message prevents stale updater builds from closing HomePanel with
// a generic WM_CLOSE before a verified installation is ready.
constexpr UINT kUpdateShutdownMessage = WM_APP + 11;

}  // namespace hp
