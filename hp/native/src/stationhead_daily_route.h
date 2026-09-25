#pragma once

#include <cstdint>
#include <string_view>

namespace hp {

// Fixed Japan Standard Time (UTC+09:00); no daylight saving transitions.
constexpr int64_t kStationheadJstOffsetMs = 9LL * 60 * 60 * 1000;
constexpr int64_t kStationheadDayMs = 24LL * 60 * 60 * 1000;
constexpr int64_t kStationheadMinuteMs = 60'000;

constexpr int64_t StationheadJstTimeOfDayMs(int64_t unixMs) noexcept {
  const int64_t shifted = (unixMs + kStationheadJstOffsetMs) % kStationheadDayMs;
  return shifted < 0 ? shifted + kStationheadDayMs : shifted;
}

constexpr std::wstring_view StationheadScheduledUrl(int64_t unixMs) noexcept {
  const int64_t time = StationheadJstTimeOfDayMs(unixMs);
  if (time >= (23 * 60 + 45) * kStationheadMinuteMs || time < 15 * kStationheadMinuteMs)
    return L"https://www.stationhead.com/c/ohisama";
  if (time >= (11 * 60 + 45) * kStationheadMinuteMs &&
      time < (12 * 60 + 15) * kStationheadMinuteMs)
    return L"https://www.stationhead.com/c/unity";
  return L"https://www.stationhead.com/sakuramankai";
}

constexpr int64_t StationheadNextRouteChangeAt(int64_t unixMs) noexcept {
  const int64_t today = unixMs - StationheadJstTimeOfDayMs(unixMs);
  const int64_t time = StationheadJstTimeOfDayMs(unixMs);
  if (time < 15 * kStationheadMinuteMs) return today + 15 * kStationheadMinuteMs;
  if (time < (11 * 60 + 45) * kStationheadMinuteMs)
    return today + (11 * 60 + 45) * kStationheadMinuteMs;
  if (time < (12 * 60 + 15) * kStationheadMinuteMs)
    return today + (12 * 60 + 15) * kStationheadMinuteMs;
  if (time < (23 * 60 + 45) * kStationheadMinuteMs)
    return today + (23 * 60 + 45) * kStationheadMinuteMs;
  return today + kStationheadDayMs + 15 * kStationheadMinuteMs;
}

static_assert(StationheadScheduledUrl(0) == L"https://www.stationhead.com/sakuramankai");
static_assert(StationheadScheduledUrl((2 * 60 + 44) * kStationheadMinuteMs) ==
              L"https://www.stationhead.com/sakuramankai");
static_assert(StationheadScheduledUrl((2 * 60 + 45) * kStationheadMinuteMs) ==
              L"https://www.stationhead.com/c/unity");
static_assert(StationheadNextRouteChangeAt((2 * 60 + 45) * kStationheadMinuteMs) ==
              (3 * 60 + 15) * kStationheadMinuteMs);
static_assert(StationheadScheduledUrl((3 * 60 + 15) * kStationheadMinuteMs) ==
              L"https://www.stationhead.com/sakuramankai");
static_assert(StationheadScheduledUrl((14 * 60 + 45) * kStationheadMinuteMs) ==
              L"https://www.stationhead.com/c/ohisama");
static_assert(StationheadScheduledUrl(15 * 60 * kStationheadMinuteMs) ==
              L"https://www.stationhead.com/c/ohisama");
static_assert(StationheadScheduledUrl((15 * 60 + 15) * kStationheadMinuteMs) ==
              L"https://www.stationhead.com/sakuramankai");
static_assert(StationheadNextRouteChangeAt((14 * 60 + 45) * kStationheadMinuteMs) ==
              (15 * 60 + 15) * kStationheadMinuteMs);

}  // namespace hp
