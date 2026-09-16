#pragma once
#include "common.h"

namespace hp {

struct MediaSurfaceAnchors {
  RECT clock{};
  RECT air{};
};

inline MediaSurfaceAnchors ComputeMediaSurfaceAnchors(
    const RECT& client) noexcept {
  const int clientWidth = std::max(1L, client.right - client.left);
  const int clientHeight = std::max(1L, client.bottom - client.top);
  const int marginX = clientWidth * 14 / 1000;
  const int marginY = clientHeight * 20 / 1000;

  const RECT inner{
      client.left + marginX,
      client.top + marginY,
      client.right - marginX,
      client.bottom - marginY,
  };
  const int innerWidth = std::max(1L, inner.right - inner.left);
  const int sideWidth = innerWidth * 285 / 1000;
  const RECT side{inner.left, inner.top, inner.left + sideWidth, inner.bottom};

  const int sideHeight = std::max(1L, side.bottom - side.top);
  const int gap = std::max(6, sideHeight * 18 / 1000);
  const int rowHeight = std::max(1, (sideHeight - gap * 2) / 3);

  MediaSurfaceAnchors anchors;
  anchors.clock = RECT{
      side.left,
      side.top,
      side.right,
      side.top + rowHeight,
  };
  anchors.air = RECT{
      side.left,
      anchors.clock.bottom + gap,
      side.right,
      anchors.clock.bottom + gap + rowHeight,
  };
  return anchors;
}

inline RECT CenterMediaSurfaceOnAnchor(
    const RECT& client,
    const RECT& anchor,
    LONG surfaceWidth,
    LONG surfaceHeight) noexcept {
  const LONG clientWidth = std::max<LONG>(1, client.right - client.left);
  const LONG clientHeight = std::max<LONG>(1, client.bottom - client.top);
  const LONG width = std::min(surfaceWidth, clientWidth);
  const LONG height = std::min(surfaceHeight, clientHeight);
  const LONG anchorWidth = std::max<LONG>(1, anchor.right - anchor.left);
  const LONG anchorHeight = std::max<LONG>(1, anchor.bottom - anchor.top);

  LONG left = anchor.left + (anchorWidth - width) / 2;
  LONG top = anchor.top + (anchorHeight - height) / 2;
  left = std::clamp(left, client.left, client.right - width);
  top = std::clamp(top, client.top, client.bottom - height);
  return RECT{left, top, left + width, top + height};
}

}  // namespace hp
