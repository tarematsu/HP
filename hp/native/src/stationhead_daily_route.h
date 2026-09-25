#pragma once

#include <cstdint>
#include <string_view>

namespace hp {

// Fixed Japan Standard Time (UTC+09:00); no daylight saving transitions.
constexpr int64_t kJstOffsetMs = 9LL * 60 * 60 * 1000;
constexpr int64_t kDayMs = 24LL * 60 * 60 * 1000;
constexpr int64_t kMinuteMs = 60'000;

constexpr int64_t StationheadJstTimeOfDayMs(int64_t unixMs) noexcept {
  const int64_t shifted = (unixMs + kJstOffsetMs) % kDayMs;
  return shifted < 0 ? shifted + kDayMs : shifted;
}

constexpr std::wstring_view StationheadScheduledUrl(int64_t unixMs) noexcept {
  const int64_t time = StationheadJstTimeOfDayMs(unixMs);
  if (time >= (23 * 60 + 45) * kMinuteMs)
    return L"https://www.stationhead.com/c/unity";
  if (time < 15 * kMinuteMs)
    return L"https://www.stationhead.com/c/ohisama";
  return L"https://www.stationhead.com/sakuramankai";
}

constexpr int64_t StationheadNextRouteChangeAt(int64_t unixMs) noexcept {
  const int64_t today = unixMs - StationheadJstTimeOfDayMs(unixMs);
  const int64_t time = StationheadJstTimeOfDayMs(unixMs);
  if (time < 15 * kMinuteMs) return today + 15 * kMinuteMs;
  if (time < (23 * 60 + 45) * kMinuteMs)
    return today + (23 * 60 + 45) * kMinuteMs;
  return today + kDayMs;
}

static_assert(StationheadScheduledUrl(0) == L"https://www.stationhead.com/sakuramankai");
static_assert(StationheadScheduledUrl((14 * 60 + 44) * kMinuteMs) ==
              L"https://www.stationhead.com/sakuramankai");
static_assert(StationheadScheduledUrl((14 * 60 + 45) * kMinuteMs) ==
              L"https://www.stationhead.com/c/unity");
static_assert(StationheadScheduledUrl(15 * 60 * kMinuteMs) ==
              L"https://www.stationhead.com/c/ohisama");
static_assert(StationheadScheduledUrl((15 * 60 + 15) * kMinuteMs) ==
              L"https://www.stationhead.com/sakuramankai");
static_assert(StationheadNextRouteChangeAt((14 * 60 + 45) * kMinuteMs) ==
              15 * 60 * kMinuteMs);

}  // namespace hp
