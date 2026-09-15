#include "app.h"
#include "web_renderer.h"
#include <winrt/Windows.Data.Json.h>

namespace hp {
namespace {
constexpr int64_t kAirHistoryWindowMs = 24LL * 60 * 60 * 1000;
constexpr int64_t kAirHistoryBucketMs = 5LL * 60 * 1000;
constexpr int64_t kAirHistoryPersistIntervalMs = 30LL * 60 * 1000;

bool ValidAirValues(const AirHistorySample& sample) noexcept {
  return sample.co2 >= 250 && sample.co2 <= 10000 &&
      sample.temperature >= -40 && sample.temperature <= 85 &&
      sample.humidity >= 0 && sample.humidity <= 100;
}

bool BeforeTimestamp(const AirHistorySample& sample, int64_t timestamp) noexcept {
  return sample.timestamp < timestamp;
}

void TrimAirHistory(std::vector<AirHistorySample>& history, int64_t cutoff) {
  history.erase(
      history.begin(),
      std::lower_bound(history.begin(), history.end(), cutoff, BeforeTimestamp));
}
}  // namespace

App::HistoryFlushGuard::~HistoryFlushGuard() {
  if (!owner) return;
  const int64_t now = UnixMillis();
  if (owner->airHistoryDirty_ && owner->SaveAirHistory()) {
    owner->airHistoryDirty_ = false;
    owner->lastAirHistorySavedAt_ = now;
  }
}

void App::LoadAirHistory() {
  try {
    std::ifstream input(dataDir_ / L"air-history.json", std::ios::binary);
    const std::string text((std::istreambuf_iterator<char>(input)), {});
    if (!text.empty()) {
      const auto array =
          winrt::Windows::Data::Json::JsonArray::Parse(Utf8ToWide(text));
      const int64_t now = UnixMillis();
      std::vector<AirHistorySample> history;
      history.reserve(array.Size());
      for (auto value : array) {
        if (value.ValueType() !=
            winrt::Windows::Data::Json::JsonValueType::Object) {
          continue;
        }
        const auto item = value.GetObject();
        AirHistorySample sample{
            static_cast<int64_t>(item.GetNamedNumber(L"t", 0)),
            static_cast<int>(item.GetNamedNumber(L"co2", 0)),
            item.GetNamedNumber(L"temperature", 0),
            item.GetNamedNumber(L"humidity", 0),
        };
        if (sample.timestamp <= now + kAirHistoryBucketMs &&
            ValidAirValues(sample)) {
          history.push_back(sample);
        }
      }
      std::sort(history.begin(), history.end(),
                [](const auto& left, const auto& right) {
                  return left.timestamp < right.timestamp;
                });
      TrimAirHistory(history, now - kAirHistoryWindowMs);
      airHistory_ = std::move(history);
      lastAirHistorySavedAt_ = now;
    }
  } catch (const std::exception& error) {
    if (logger_) logger_->Warn(L"Air history load failed: " + Utf8ToWide(error.what()));
  } catch (...) {
    if (logger_) logger_->Warn(L"Air history load failed with an unknown error");
  }
  if (renderer_) renderer_->UpdateAirHistory(airHistory_);
}

bool App::SaveAirHistory() const {
  try {
    std::ostringstream output;
    output << "[";
    bool first = true;
    for (const auto& sample : airHistory_) {
      if (!first) output << ",";
      first = false;
      output << "{\"t\":" << sample.timestamp
             << ",\"co2\":" << sample.co2
             << ",\"temperature\":" << sample.temperature
             << ",\"humidity\":" << sample.humidity << "}";
    }
    output << "]";
    if (!AtomicWriteText(dataDir_ / L"air-history.json", output.str())) {
      if (logger_) logger_->Warn(L"Air history atomic write failed");
      return false;
    }
    return true;
  } catch (const std::exception& error) {
    if (logger_) logger_->Warn(L"Air history save failed: " + Utf8ToWide(error.what()));
  } catch (...) {
    if (logger_) logger_->Warn(L"Air history save failed with an unknown error");
  }
  return false;
}

void App::UpdateAirHistory(const SensorSnapshot& sensors) {
  const int64_t now = UnixMillis();
  if (!sensors.co2Connected || sensors.observedAt <= 0 ||
      sensors.observedAt > now + kAirHistoryBucketMs) {
    return;
  }

  const AirHistorySample sample{
      sensors.observedAt / kAirHistoryBucketMs * kAirHistoryBucketMs,
      sensors.co2,
      sensors.temperatureCorrected,
      sensors.humidityCorrected,
  };
  if (sample.timestamp < now - kAirHistoryWindowMs || !ValidAirValues(sample)) return;

  const auto position = std::lower_bound(
      airHistory_.begin(), airHistory_.end(), sample.timestamp, BeforeTimestamp);
  if (position != airHistory_.end() && position->timestamp == sample.timestamp) return;
  airHistory_.insert(position, sample);
  TrimAirHistory(airHistory_, now - kAirHistoryWindowMs);

  airHistoryDirty_ = true;
  if (lastAirHistorySavedAt_ <= 0 ||
      now - lastAirHistorySavedAt_ >= kAirHistoryPersistIntervalMs) {
    if (SaveAirHistory()) {
      airHistoryDirty_ = false;
      lastAirHistorySavedAt_ = now;
    }
  }
  if (renderer_) renderer_->UpdateAirHistory(airHistory_);
}

}  // namespace hp
