#pragma once
#include "common.h"

namespace hp {

inline bool StationheadPlaybackRenderingSuppressed(
    ICoreWebView2Controller*) noexcept {
  return false;
}

}  // namespace hp
