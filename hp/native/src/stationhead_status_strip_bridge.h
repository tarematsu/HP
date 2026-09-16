#pragma once

// This header is intentionally namespace-neutral because both callers include it
// from inside namespace hp. It carries only the already-computed value; API
// parsing and date summarization remain owned by the Stationhead side.
inline std::atomic<int64_t> stationheadStatusStripTodayPlayCount{-1};

inline void PublishStationheadStatusStripPlayCount(int64_t count) noexcept {
  stationheadStatusStripTodayPlayCount.store(count, std::memory_order_release);
}

inline int64_t StationheadStatusStripTodayPlayCount() noexcept {
  return stationheadStatusStripTodayPlayCount.load(std::memory_order_acquire);
}
