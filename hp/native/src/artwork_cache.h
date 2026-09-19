#pragma once

#include "common.h"

namespace hp {

// Native dashboard artwork rendering has been removed. Keep this compatibility
// shim only until dashboard playback parsing drops the historical field; it
// intentionally performs no download, disk cache, or in-memory URL indexing.
inline std::wstring CacheArtworkUrl(const fs::path&,
                                     const std::wstring&,
                                     const wchar_t* = nullptr) {
  return {};
}

}  // namespace hp
