#include "stationhead_native_stats.h"

#include <deque>
#include <winrt/Windows.Data.Json.h>

namespace hp {
namespace {

constexpr int64_t kDayMs = 24LL * 60 * 60 * 1000;
constexpr int64_t kHistorySampleBucketMs = 5LL * 60 * 1000;
constexpr size_t kMaximumBodyBytes = 1024 * 1024;

std::wstring LowerAscii(std::wstring_view value) {
  std::wstring lower(value);
  std::transform(lower.begin(), lower.end(), lower.begin(), [](wchar_t ch) {
    return static_cast<wchar_t>(
        ch >= L'A' && ch <= L'Z' ? ch - L'A' + L'a' : ch);
  });
  return lower;
}

bool IsStatsUri(std::wstring_view uri, int channelId) {
  if (channelId <= 0 || uri.empty()) return false;
  const std::wstring lower = LowerAscii(uri);
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
  return std::wstring_view(lower).substr(pathStart, pathEnd - pathStart) ==
      expected;
}

bool ParseStatsJson(
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

bool ReadResponseBody(IStream* stream, std::string& output) {
  output.clear();
  if (!stream) return false;

  std::array<char, 8192> buffer{};
  for (;;) {
    const size_t remaining = kMaximumBodyBytes + 1 - output.size();
    if (remaining == 0) {
      output.clear();
      return false;
    }
    const ULONG requested = static_cast<ULONG>(
        std::min<size_t>(buffer.size(), remaining));
    ULONG read = 0;
    const HRESULT result = stream->Read(buffer.data(), requested, &read);
    if (FAILED(result)) {
      output.clear();
      return false;
    }
    if (read > 0) output.append(buffer.data(), read);
    if (output.size() > kMaximumBodyBytes) {
      output.clear();
      return false;
    }
    if (read == 0 || result == S_FALSE) break;
  }
  return !output.empty();
}

void ConsumeStatsResponse(
    ICoreWebView2WebResourceResponseReceivedEventArgs* args,
    int channelId) {
  if (!args || channelId <= 0) return;

  ComPtr<ICoreWebView2WebResourceRequest> request;
  if (FAILED(args->get_Request(&request)) || !request) return;
  LPWSTR uriRaw = nullptr;
  if (FAILED(request->get_Uri(&uriRaw)) || !uriRaw) return;
  const std::wstring uri(uriRaw);
  CoTaskMemFree(uriRaw);
  if (!IsStatsUri(uri, channelId)) return;

  ComPtr<ICoreWebView2WebResourceResponseView> response;
  if (FAILED(args->get_Response(&response)) || !response) return;
  int status = 0;
  if (FAILED(response->get_StatusCode(&status)) || status < 200 || status >= 300) {
    return;
  }

  response->GetContent(
      Callback<ICoreWebView2WebResourceResponseViewGetContentCompletedHandler>(
          [](HRESULT result, IStream* content) -> HRESULT {
            if (FAILED(result) || !content) return S_OK;
            std::string body;
            if (!ReadResponseBody(content, body)) return S_OK;
            const int64_t receivedAt = UnixMillis();
            std::vector<StationheadNativeDailyPlayPoint> daily;
            if (!ParseStatsJson(body, receivedAt, daily)) return S_OK;
            StatsStore().Publish(std::move(daily), receivedAt);
            return S_OK;
          }).Get());
}

}  // namespace

void AttachStationheadNativeStats(ICoreWebView2* webview, int channelId) {
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
            ConsumeStatsResponse(args, channelId);
            return S_OK;
          }).Get(),
      &ignoredToken);
}

StationheadNativeStatsSnapshot GetStationheadNativeStatsSnapshot() {
  return StatsStore().Snapshot();
}

uint64_t GetStationheadNativeStatsRevision() {
  return StatsStore().Revision();
}

}  // namespace hp
