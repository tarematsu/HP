#pragma once

#include <algorithm>
#include <cstdint>

namespace hp {

inline constexpr int64_t kHourlyCollectionIntervalMs = 60 * 60'000LL;

inline int64_t NextHourlyCollectionSlot(int64_t nowMs, int phaseMinute) noexcept {
  const int clampedPhaseMinute = std::clamp(phaseMinute, 0, 59);
  const int64_t phaseMs = static_cast<int64_t>(clampedPhaseMinute) * 60'000LL;
  const int64_t hourStart =
      (nowMs / kHourlyCollectionIntervalMs) * kHourlyCollectionIntervalMs;
  int64_t candidate = hourStart + phaseMs;
  if (candidate <= nowMs) candidate += kHourlyCollectionIntervalMs;
  return candidate;
}

}  // namespace hp
