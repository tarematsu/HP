#include "stationhead_native_stats.h"

#include <deque>
#include <winrt/Windows.Data.Json.h>

namespace hp {
namespace {

constexpr int64_t kDayMs = 24LL * 60 * 60 * 1000;
constexpr int64_t kHistorySampleBucketMs = 5LL * 60 * 1000;

bool ParseStatsObject(
    const winrt::Windows::Data::Json::JsonObject& root,
    int64_t referenceAt,
    std::vector<StationheadNativeDailyPlayPoint>& output) {
  output.clear();
  if (referenceAt <= 0 || !root.HasKey(L"chart_data")) return false;
  try {
    const auto chart = root.GetNamedArray(L"chart_data");
    constexpr uint32_t kMaximumPoints = 256;
    constexpr int64_t kMaximumPastMs = 60LL * kDayMs;
    constexpr int64_t kMaximumFutureMs = 2LL * kDayMs;
    const uint32_t count = std::min<uint32_t>(chart.Size(), kMaximumPoints);
    output.reserve(count);
    for (uint32_t index = 0; index < count; ++index) {
      const auto value = chart.GetAt(index);
      if (value.ValueType() !=
          winrt::Windows::Data::Json::JsonValueType::Object) {
        continue;
      }
      const auto point = value.GetObject();
      if (!point.HasKey(L"ts") || !point.HasKey(L"val")) continue;
      const double rawTimestamp = point.GetNamedNumber(L"ts", 0);
      const double rawValue = point.GetNamedNumber(L"val", -1);
      if (!std::isfinite(rawTimestamp) || !std::isfinite(rawValue) ||
          rawTimestamp <= 0 || std::trunc(rawTimestamp) != rawTimestamp ||
          rawTimestamp > static_cast<double>(INT64_MAX) || rawValue < 0 ||
          rawValue > static_cast<double>(std::numeric_limits<int>::max())) {
        continue;
      }
      const int64_t timestamp = static_cast<int64_t>(rawTimestamp);
      if (timestamp < referenceAt - kMaximumPastMs ||
          timestamp > referenceAt + kMaximumFutureMs) {
        continue;
      }
      const int64_t dayStart = timestamp - timestamp % kDayMs;
      output.push_back({dayStart, static_cast<int>(std::round(rawValue))});
    }

    std::stable_sort(
        output.begin(), output.end(),
        [](const auto& left, const auto& right) {
          return left.dayStartMsUtc < right.dayStartMsUtc;
        });
    std::vector<StationheadNativeDailyPlayPoint> normalized;
    normalized.reserve(output.size());
    for (const auto& point : output) {
      if (!normalized.empty() &&
          normalized.back().dayStartMsUtc == point.dayStartMsUtc) {
        normalized.back().value = point.value;
      } else {
        normalized.push_back(point);
      }
    }
    if (normalized.size() > 45) {
      normalized.erase(normalized.begin(), normalized.end() - 45);
    }
    output = std::move(normalized);
    return !output.empty();
  } catch (...) {
    output.clear();
    return false;
  }
}

class NativeStatsStore {
 public:
  void Publish(
      std::vector<StationheadNativeDailyPlayPoint> daily,
      int64_t receivedAt) {
    if (daily.empty() || receivedAt <= 0) return;
    std::lock_guard lock(mutex_);
    daily_ = std::move(daily);
    updatedAt_ = receivedAt;

    const int64_t today = receivedAt / kDayMs;
    const auto current = std::find_if(
        daily_.rbegin(), daily_.rend(), [today](const auto& point) {
          return point.dayStartMsUtc / kDayMs == today;
        });
    if (current != daily_.rend()) {
      const std::pair<int64_t, int> sample{receivedAt, current->value};
      const int64_t bucket = receivedAt / kHistorySampleBucketMs;
      if (!history_.empty() &&
          history_.back().first / kHistorySampleBucketMs == bucket) {
        history_.back() = sample;
      } else {
        history_.push_back(sample);
      }
      const int64_t cutoff = receivedAt - 2LL * 60 * 60 * 1000;
      while (!history_.empty() && history_.front().first < cutoff) {
        history_.pop_front();
      }
    }
    ++revision_;
  }

  StationheadNativeStatsSnapshot Snapshot() const {
    std::lock_guard lock(mutex_);
    StationheadNativeStatsSnapshot snapshot;
    snapshot.daily = daily_;
    snapshot.updatedAt = updatedAt_;
    snapshot.revision = revision_;
    if (history_.size() >= 2) {
      const auto& latest = history_.back();
      const int64_t target = latest.first - 60LL * 60 * 1000;
      const auto baseline = std::upper_bound(
          history_.begin(), history_.end(), target,
          [](int64_t timestamp, const auto& sample) {
            return timestamp < sample.first;
          });
      if (baseline != history_.begin()) {
        const int delta = latest.second - std::prev(baseline)->second;
        snapshot.recentHour = delta >= 0 ? delta : latest.second;
      }
    }
    return snapshot;
  }

  uint64_t Revision() const {
    std::lock_guard lock(mutex_);
    return revision_;
  }

 private:
  mutable std::mutex mutex_;
  std::vector<StationheadNativeDailyPlayPoint> daily_;
  std::deque<std::pair<int64_t, int>> history_;
  int64_t updatedAt_ = 0;
  uint64_t revision_ = 0;
};

NativeStatsStore& StatsStore() {
  static auto* store = new NativeStatsStore();
  return *store;
}

}  // namespace

bool PublishStationheadNativeStatsMessage(std::wstring_view messageJson) {
  if (messageJson.empty()) return false;
  try {
    const auto message = winrt::Windows::Data::Json::JsonObject::Parse(
        std::wstring(messageJson));
    if (message.GetNamedString(L"type", L"") != L"stationhead-play-stats" ||
        !message.HasKey(L"data")) {
      return false;
    }
    const auto data = message.GetNamedObject(L"data");
    const int64_t receivedAt = UnixMillis();
    std::vector<StationheadNativeDailyPlayPoint> daily;
    if (!ParseStatsObject(data, receivedAt, daily)) return false;
    StatsStore().Publish(std::move(daily), receivedAt);
    return true;
  } catch (...) {
    return false;
  }
}

StationheadNativeStatsSnapshot GetStationheadNativeStatsSnapshot() {
  return StatsStore().Snapshot();
}

uint64_t GetStationheadNativeStatsRevision() {
  return StatsStore().Revision();
}

}  // namespace hp
