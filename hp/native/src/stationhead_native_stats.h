#pragma once

#include "common.h"
#include <deque>
#include <winrt/Windows.Data.Json.h>

namespace hp {

struct StationheadNativeDailyPlayPoint {
  int64_t dayStartMsUtc = 0;
  int value = 0;
};

struct StationheadNativeStatsSnapshot {
  std::vector<StationheadNativeDailyPlayPoint> daily;
  int recentHour = -1;
  int64_t updatedAt = 0;
  uint64_t revision = 0;
};

inline constexpr int64_t kStationheadNativeStatsDayMs =
    24LL * 60 * 60 * 1000;
inline constexpr size_t kStationheadNativeStatsMaximumBodyBytes = 1024 * 1024;

inline bool IsStationheadNativeStatsUri(std::wstring_view uri, int channelId) {
  if (channelId <= 0 || uri.empty()) return false;
  std::wstring lower(uri);
  std::transform(lower.begin(), lower.end(), lower.begin(), [](wchar_t value) {
    return static_cast<wchar_t>(
        value >= L'A' && value <= L'Z' ? value - L'A' + L'a' : value);
  });
  constexpr std::wstring_view scheme = L"https://";
  if (!lower.starts_with(scheme)) return false;
  const size_t hostStart = scheme.size();
  const size_t pathStart = lower.find(L'/', hostStart);
  if (pathStart == std::wstring::npos) return false;
  if (std::wstring_view(lower).substr(hostStart, pathStart - hostStart) !=
      L"production1.stationhead.com") {
    return false;
  }
  size_t pathEnd = lower.find_first_of(L"?#", pathStart);
  if (pathEnd == std::wstring::npos) pathEnd = lower.size();
  std::wstring expected = L"/me/channel/";
  expected += std::to_wstring(channelId);
  expected += L"/streakstats";
  return std::wstring_view(lower).substr(pathStart, pathEnd - pathStart) == expected;
}

inline bool ReadStationheadNativeStatsStream(
    IStream* stream, std::string& output) {
  output.clear();
  if (!stream) return false;
  std::array<char, 16 * 1024> buffer{};
  while (output.size() < kStationheadNativeStatsMaximumBodyBytes) {
    ULONG read = 0;
    const ULONG capacity = static_cast<ULONG>(std::min(
        buffer.size(),
        kStationheadNativeStatsMaximumBodyBytes - output.size()));
    const HRESULT result = stream->Read(buffer.data(), capacity, &read);
    if (FAILED(result)) return false;
    if (read == 0) return !output.empty();
    output.append(buffer.data(), static_cast<size_t>(read));
    if (result == S_FALSE) break;
  }
  return !output.empty() &&
      output.size() <= kStationheadNativeStatsMaximumBodyBytes;
}

inline bool ParseStationheadNativeStatsJson(
    std::string_view utf8,
    int64_t referenceAt,
    std::vector<StationheadNativeDailyPlayPoint>& output) {
  output.clear();
  if (utf8.empty() || referenceAt <= 0) return false;
  try {
    const auto root = winrt::Windows::Data::Json::JsonObject::Parse(
        Utf8ToWide(std::string(utf8)));
    if (!root.HasKey(L"chart_data")) return false;
    const auto chart = root.GetNamedArray(L"chart_data");
    constexpr uint32_t kMaximumPoints = 256;
    constexpr int64_t kMaximumPastMs = 60LL * kStationheadNativeStatsDayMs;
    constexpr int64_t kMaximumFutureMs = 2LL * kStationheadNativeStatsDayMs;
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
      const int64_t dayStart =
          timestamp - timestamp % kStationheadNativeStatsDayMs;
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

class StationheadNativeStatsStore {
 public:
  void Publish(
      std::vector<StationheadNativeDailyPlayPoint> daily,
      int64_t receivedAt) {
    if (daily.empty() || receivedAt <= 0) return;
    std::lock_guard lock(mutex_);
    daily_ = std::move(daily);
    updatedAt_ = receivedAt;

    const int64_t today = receivedAt / kStationheadNativeStatsDayMs;
    const auto current = std::find_if(
        daily_.rbegin(), daily_.rend(), [today](const auto& point) {
          return point.dayStartMsUtc / kStationheadNativeStatsDayMs == today;
        });
    if (current != daily_.rend()) {
      history_.push_back({receivedAt, current->value});
      const int64_t cutoff = receivedAt - 2LL * 60 * 60 * 1000;
      while (!history_.empty() && history_.front().first < cutoff) {
        history_.pop_front();
      }
      while (history_.size() >= 2 &&
             history_[history_.size() - 2].second == history_.back().second) {
        history_.erase(history_.end() - 2);
      }
    }
    ++revision_;
  }

  [[nodiscard]] StationheadNativeStatsSnapshot Snapshot() const {
    std::lock_guard lock(mutex_);
    StationheadNativeStatsSnapshot snapshot;
    snapshot.daily = daily_;
    snapshot.updatedAt = updatedAt_;
    snapshot.revision = revision_;
    if (history_.size() >= 2) {
      const auto& latest = history_.back();
      const int64_t target = latest.first - 60LL * 60 * 1000;
      auto baseline = std::upper_bound(
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

  [[nodiscard]] uint64_t Revision() const {
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

inline StationheadNativeStatsStore& GlobalStationheadNativeStatsStore() {
  static StationheadNativeStatsStore store;
  return store;
}

inline void AttachStationheadNativeStatsObserver(
    ICoreWebView2* webview, int channelId) {
  if (!webview || channelId <= 0) return;
  ComPtr<ICoreWebView2> base = webview;
  ComPtr<ICoreWebView2_2> responseWebView;
  if (FAILED(base.As(&responseWebView)) || !responseWebView) return;

  EventRegistrationToken ignoredToken{};
  responseWebView->add_WebResourceResponseReceived(
      Callback<ICoreWebView2WebResourceResponseReceivedEventHandler>(
          [channelId](
              ICoreWebView2*,
              ICoreWebView2WebResourceResponseReceivedEventArgs* args)
              -> HRESULT {
            if (!args) return S_OK;
            ComPtr<ICoreWebView2WebResourceRequest> request;
            if (FAILED(args->get_Request(&request)) || !request) return S_OK;
            LPWSTR uriRaw = nullptr;
            if (FAILED(request->get_Uri(&uriRaw)) || !uriRaw) return S_OK;
            const std::wstring uri(uriRaw);
            CoTaskMemFree(uriRaw);
            if (!IsStationheadNativeStatsUri(uri, channelId)) return S_OK;

            ComPtr<ICoreWebView2WebResourceResponseView> response;
            if (FAILED(args->get_Response(&response)) || !response) return S_OK;
            int status = 0;
            if (FAILED(response->get_StatusCode(&status)) ||
                status < 200 || status >= 300) {
              return S_OK;
            }
            ComPtr<ICoreWebView2WebResourceResponseView> retainedResponse = response;
            response->GetContent(
                Callback<ICoreWebView2WebResourceResponseViewGetContentCompletedHandler>(
                    [retainedResponse](HRESULT result, IStream* stream) -> HRESULT {
                      (void)retainedResponse;
                      if (FAILED(result) || !stream) return S_OK;
                      std::string body;
                      if (!ReadStationheadNativeStatsStream(stream, body)) return S_OK;
                      const int64_t receivedAt = UnixMillis();
                      std::vector<StationheadNativeDailyPlayPoint> daily;
                      if (!ParseStationheadNativeStatsJson(
                              body, receivedAt, daily)) {
                        return S_OK;
                      }
                      GlobalStationheadNativeStatsStore().Publish(
                          std::move(daily), receivedAt);
                      return S_OK;
                    }).Get());
            return S_OK;
          }).Get(),
      &ignoredToken);
}

}  // namespace hp
