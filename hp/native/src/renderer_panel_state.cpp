#include "web_renderer.h"
#include "stationhead_native_stats.h"
#include "winhttp_helpers.h"
#include <cmath>

namespace hp {
namespace {
constexpr int64_t kAirGraphWindowMs = 24LL * 60 * 60 * 1000;
constexpr int kAirStatsCo2InvalidateDeltaPpm = 5;
constexpr double kAirStatsTemperatureInvalidateDeltaC = 0.1;
constexpr double kAirStatsHumidityInvalidateDeltaPercent = 1.0;

bool ValidAirGraphSample(const AirHistorySample& sample, int64_t cutoff) noexcept {
  return sample.timestamp >= cutoff && sample.co2 >= 250 && sample.co2 <= 10000 &&
      sample.temperature >= -40 && sample.temperature <= 85 &&
      sample.humidity >= 0 && sample.humidity <= 100;
}

bool AirStatsNeedRepaint(const SensorSnapshot& previous,
                         const SensorSnapshot& next) noexcept {
  if (previous.co2Connected != next.co2Connected) return true;
  if (!next.co2Connected) return false;
  return std::abs(next.co2 - previous.co2) >= kAirStatsCo2InvalidateDeltaPpm ||
      std::abs(next.temperatureCorrected - previous.temperatureCorrected) >=
          kAirStatsTemperatureInvalidateDeltaC ||
      std::abs(next.humidityCorrected - previous.humidityCorrected) >=
          kAirStatsHumidityInvalidateDeltaPercent;
}

struct StationheadRevisionCache {
  const Renderer* owner = nullptr;
  uint64_t history = 0;
  uint64_t nativeStats = 0;
};

StationheadRevisionCache& StationheadRevisionsFor(const Renderer* owner) {
  static StationheadRevisionCache cache;
  if (cache.owner != owner) {
    cache.owner = owner;
    cache.history = std::numeric_limits<uint64_t>::max();
    cache.nativeStats = GlobalStationheadNativeStatsStore().Revision();
  }
  return cache;
}

std::wstring ClockDateText(const SYSTEMTIME& now) {
  static constexpr const wchar_t* kWeekdays[] = {
      L"日", L"月", L"火", L"水", L"木", L"金", L"土"};
  wchar_t text[64]{};
  swprintf_s(text, L"%04u年%u月%u日 (%s)", now.wYear, now.wMonth, now.wDay,
             kWeekdays[now.wDayOfWeek % 7]);
  return text;
}

std::wstring ClockTimeText(const SYSTEMTIME& now) {
  wchar_t text[16]{};
  swprintf_s(text, L"%02u:%02u:%02u", now.wHour, now.wMinute, now.wSecond);
  return text;
}
}  // namespace

void Renderer::RebuildNativeAirGraph(int64_t nowMs) {
  AirGraphProjection next;
  next.cutoff = nowMs - kAirGraphWindowMs;
  next.samples.reserve(nativeAirHistory_.size());
  double co2Min = std::numeric_limits<double>::max();
  double co2Max = std::numeric_limits<double>::lowest();
  double temperatureMin = std::numeric_limits<double>::max();
  double temperatureMax = std::numeric_limits<double>::lowest();
  double humidityMin = std::numeric_limits<double>::max();
  double humidityMax = std::numeric_limits<double>::lowest();
  for (const auto& sample : nativeAirHistory_) {
    if (!ValidAirGraphSample(sample, next.cutoff)) continue;
    next.samples.push_back(sample);
    co2Min = std::min(co2Min, static_cast<double>(sample.co2));
    co2Max = std::max(co2Max, static_cast<double>(sample.co2));
    temperatureMin = std::min(temperatureMin, sample.temperature);
    temperatureMax = std::max(temperatureMax, sample.temperature);
    humidityMin = std::min(humidityMin, sample.humidity);
    humidityMax = std::max(humidityMax, sample.humidity);
  }
  if (!next.samples.empty()) {
    next.co2Min = co2Min;
    next.co2Max = co2Max;
    next.temperatureMin = temperatureMin;
    next.temperatureMax = temperatureMax;
    next.humidityMin = humidityMin;
    next.humidityMax = humidityMax;
  }
  nativeAirGraph_ = std::move(next);
}

void Renderer::UpdateSensors(const SensorSnapshot& sensors) {
  if (nativeSensors_ == sensors) return;

  // Keep the air values at the last painted baseline until the visible value has
  // moved enough to matter. Non-air state still advances immediately so this
  // optimization cannot make SwitchBot/telemetry state stale inside Renderer.
  const bool repaintAirStats = AirStatsNeedRepaint(nativeSensors_, sensors);
  if (repaintAirStats) {
    nativeSensors_ = sensors;
  } else {
    nativeSensors_.observedAt = sensors.observedAt;
    nativeSensors_.presence = sensors.presence;
    nativeSensors_.light = sensors.light;
    nativeSensors_.motion = sensors.motion;
    nativeSensors_.doorOpen = sensors.doorOpen;
    nativeSensors_.outboxCount = sensors.outboxCount;
    nativeSensors_.lastError = sensors.lastError;
  }

  if (!repaintAirStats || !nativeDashboardVisible_ || !EnsureNativeStaticWindows()) return;
  InvalidatePanelSection(nativeSideWindow_, PanelSection::AirStats);
}

void Renderer::UpdateAirHistory(const std::vector<AirHistorySample>& history) {
  if (nativeAirHistory_ == history) return;

  const bool appended = history.size() == nativeAirHistory_.size() + 1 &&
      std::equal(nativeAirHistory_.begin(), nativeAirHistory_.end(), history.begin());
  const bool rolled = history.size() == nativeAirHistory_.size() &&
      history.size() > 1 && nativeAirHistory_.size() > 1 &&
      std::equal(nativeAirHistory_.begin() + 1, nativeAirHistory_.end(), history.begin());
  const bool incremental = appended || rolled;

  if (appended) {
    nativeAirHistory_.push_back(history.back());
  } else if (rolled) {
    nativeAirHistory_.erase(nativeAirHistory_.begin());
    nativeAirHistory_.push_back(history.back());
  } else {
    nativeAirHistory_ = history;
  }

  if (!nativeDashboardVisible_) {
    nativeAirGraph_ = {};
    return;
  }

  const int64_t nowMs = UnixMillis();
  if (!incremental || nativeAirGraph_.samples.empty()) {
    RebuildNativeAirGraph(nowMs);
  } else {
    // History normally advances by one five-minute bucket. Update only that
    // delta instead of rebuilding/copying the complete 24-hour projection.
    const int64_t cutoff = nowMs - kAirGraphWindowMs;
    nativeAirGraph_.cutoff = cutoff;
    const auto retained = std::lower_bound(
        nativeAirGraph_.samples.begin(), nativeAirGraph_.samples.end(), cutoff,
        [](const AirHistorySample& sample, int64_t value) {
          return sample.timestamp < value;
        });
    if (retained != nativeAirGraph_.samples.begin()) {
      nativeAirGraph_.samples.erase(nativeAirGraph_.samples.begin(), retained);
    }
    if (!history.empty() && ValidAirGraphSample(history.back(), cutoff) &&
        (nativeAirGraph_.samples.empty() ||
         nativeAirGraph_.samples.back().timestamp < history.back().timestamp)) {
      nativeAirGraph_.samples.push_back(history.back());
    }

    if (nativeAirGraph_.samples.empty()) {
      nativeAirGraph_.co2Min = 0;
      nativeAirGraph_.co2Max = 0;
      nativeAirGraph_.temperatureMin = 0;
      nativeAirGraph_.temperatureMax = 0;
      nativeAirGraph_.humidityMin = 0;
      nativeAirGraph_.humidityMax = 0;
    } else {
      double co2Min = std::numeric_limits<double>::max();
      double co2Max = std::numeric_limits<double>::lowest();
      double temperatureMin = std::numeric_limits<double>::max();
      double temperatureMax = std::numeric_limits<double>::lowest();
      double humidityMin = std::numeric_limits<double>::max();
      double humidityMax = std::numeric_limits<double>::lowest();
      for (const auto& sample : nativeAirGraph_.samples) {
        co2Min = std::min(co2Min, static_cast<double>(sample.co2));
        co2Max = std::max(co2Max, static_cast<double>(sample.co2));
        temperatureMin = std::min(temperatureMin, sample.temperature);
        temperatureMax = std::max(temperatureMax, sample.temperature);
        humidityMin = std::min(humidityMin, sample.humidity);
        humidityMax = std::max(humidityMax, sample.humidity);
      }
      nativeAirGraph_.co2Min = co2Min;
      nativeAirGraph_.co2Max = co2Max;
      nativeAirGraph_.temperatureMin = temperatureMin;
      nativeAirGraph_.temperatureMax = temperatureMax;
      nativeAirGraph_.humidityMin = humidityMin;
      nativeAirGraph_.humidityMax = humidityMax;
    }
  }

  if (!EnsureNativeStaticWindows()) return;
  InvalidatePanelSection(nativeSideWindow_, PanelSection::AirGraph);
}

void Renderer::UpdateNativeStaticPanels(const RenderState& state) {
  // Stationhead is disabled in the current build, but keep its rendering path
  // intact without making active sensor/dashboard updates pass through it.
  StationheadRevisionCache& revisions = StationheadRevisionsFor(this);
  const bool stationheadChanged = nativeStationhead_ != state.stationhead;
  const bool historyChanged =
      revisions.history != state.stationheadPlayHistoryRevision;

  if (historyChanged) {
    nativeStationheadPlayHistory_ = state.stationheadPlayHistory;
    revisions.history = state.stationheadPlayHistoryRevision;
  }
  if (stationheadChanged) nativeStationhead_ = state.stationhead;

  // Stationhead data is retained for compatibility, but no active native card
  // renders it. Do not repaint the unrelated rain-radar card when it changes.
}

void Renderer::TickNativePanels(int64_t nowMs, bool timerDriven) {
  (void)nowMs;
  if (!nativeDashboardVisible_ || (!timerDriven && nativePanelTimerActive_)) return;

  StationheadRevisionCache& revisions = StationheadRevisionsFor(this);
  const uint64_t nativeStatsRevision = GlobalStationheadNativeStatsStore().Revision();
  if (revisions.nativeStats != nativeStatsRevision) {
    revisions.nativeStats = nativeStatsRevision;
  }

  SYSTEMTIME localTime{};
  const bool previousClockReady = nativeClockReady_;
  const bool clockReady = NetworkClockJstNow(&localTime);
  const int clockDayKey = clockReady
      ? static_cast<int>(localTime.wYear) * 10'000 +
            static_cast<int>(localTime.wMonth) * 100 + static_cast<int>(localTime.wDay)
      : 0;
  const bool clockDayChanged = clockReady && clockDayKey != nativeClockDayKey_;
  const int64_t clockSecondKey = clockReady
      ? (((static_cast<int64_t>(clockDayKey) * 24 + localTime.wHour) * 60 +
          localTime.wMinute) * 60 + localTime.wSecond)
      : -1;
  const int64_t previousClockSecondKey = nativeClockSecondKey_;
  const bool clockSecondChanged = clockSecondKey != previousClockSecondKey;
  const bool clockMinuteChanged = previousClockSecondKey < 0 ||
      (clockReady && clockSecondKey / 60 != previousClockSecondKey / 60);
  const bool clockReadyChanged = clockReady != previousClockReady;

  if (clockReady) {
    nativeClockNow_ = localTime;
    if (clockDayChanged || clockReadyChanged || nativeClockDateText_.empty()) {
      nativeClockDateText_ = ClockDateText(localTime);
    }
    if (clockSecondChanged || clockReadyChanged) {
      nativeClockTimeText_ = ClockTimeText(localTime);
    }
  } else if (clockReadyChanged) {
    nativeClockDateText_ = L"時刻同期中";
    nativeClockTimeText_ = L"--:--:--";
  }
  nativeClockReady_ = clockReady;
  nativeClockDayKey_ = clockDayKey;
  nativeClockSecondKey_ = clockSecondKey;

  if (nativeSideWindow_ && IsWindow(nativeSideWindow_) &&
      IsWindowVisible(nativeSideWindow_) && (clockSecondChanged || clockReadyChanged)) {
    InvalidatePanelSection(
        nativeSideWindow_,
        clockDayChanged || clockMinuteChanged || clockReadyChanged
            ? PanelSection::Clock
            : PanelSection::ClockTime);
  }

  if (clockDayChanged && nativeMainWindow_ && IsWindow(nativeMainWindow_) &&
      IsWindowVisible(nativeMainWindow_)) {
    InvalidateRect(nativeMainWindow_, nullptr, FALSE);
  }

  // Playback and Stationhead state have no active native card. In particular,
  // they must never invalidate the semantically separate rain-radar section.
}

}  // namespace hp
