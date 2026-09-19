#pragma once
#include "web_renderer.h"

namespace hp {

inline constexpr size_t kServiceMonitorTileCount = 6;
inline constexpr size_t kServiceMonitorColumns = 3;
inline constexpr size_t kServiceMonitorRows = 2;

inline RECT ServiceMonitorTileBounds(
    const RECT& workspaceBounds, size_t tileIndex) noexcept {
  if (workspaceBounds.right <= workspaceBounds.left ||
      workspaceBounds.bottom <= workspaceBounds.top) {
    return workspaceBounds;
  }

  tileIndex = std::min(tileIndex, kServiceMonitorTileCount - 1);
  const size_t column = tileIndex % kServiceMonitorColumns;
  const size_t row = tileIndex / kServiceMonitorColumns;
  const LONG width = std::max<LONG>(1, workspaceBounds.right - workspaceBounds.left);
  const LONG height = std::max<LONG>(1, workspaceBounds.bottom - workspaceBounds.top);
  const LONG left = workspaceBounds.left +
      static_cast<LONG>(width * column / kServiceMonitorColumns);
  const LONG right = workspaceBounds.left +
      static_cast<LONG>(width * (column + 1) / kServiceMonitorColumns);
  const LONG top = workspaceBounds.top +
      static_cast<LONG>(height * row / kServiceMonitorRows);
  const LONG bottom = workspaceBounds.top +
      static_cast<LONG>(height * (row + 1) / kServiceMonitorRows);
  return RECT{
      left,
      top,
      std::max<LONG>(left + 1, right),
      std::max<LONG>(top + 1, bottom),
  };
}

}  // namespace hp
