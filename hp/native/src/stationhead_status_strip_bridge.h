#pragma once
#include "stationhead_play_summary.h"

namespace hp {

// The Stationhead player and the native media strip live in separate translation
// units. Publish only the already-fetched daily count so the status strip never
// adds another Stationhead request or polling loop.
inline std::atomic<int64_t> stationheadStatusStripTodayPlayCount{-1};

inline void PublishStationheadStatusStripPlayCount(
    const StationheadStatus& status, int64_t nowMs) noexcept {
  const auto summary = SummarizeStationheadDailyPlays(status.dailyPlayCounts, nowMs);
  stationheadStatusStripTodayPlayCount.store(
      summary.today, std::memory_order_release);
}

inline int64_t StationheadStatusStripTodayPlayCount() noexcept {
  return stationheadStatusStripTodayPlayCount.load(std::memory_order_acquire);
}

}  // namespace hp
