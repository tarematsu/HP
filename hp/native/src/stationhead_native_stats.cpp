#include "stationhead_native_stats.h"

#include <deque>
#include <winrt/Windows.Data.Json.h>

namespace hp {
namespace {

constexpr int64_t kDayMs = 24LL * 60 * 60 * 1000;
constexpr int64_t kHistorySampleBucketMs = 5LL * 60 * 1000;
constexpr size_t kMaximumBodyBytes = 1024 * 1024;
constexpr size_t kMaximumPendingRequests = 16;

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

using PendingRequestIds = std::vector<std::wstring>;

void RememberPendingRequest(PendingRequestIds& pending, std::wstring requestId) {
  if (requestId.empty()) return;
  if (std::find(pending.begin(), pending.end(), requestId) != pending.end()) {
    return;
  }
  if (pending.size() >= kMaximumPendingRequests) {
    pending.erase(pending.begin());
  }
  pending.push_back(std::move(requestId));
}

bool TakePendingRequest(PendingRequestIds& pending, std::wstring_view requestId) {
  const auto found = std::find(pending.begin(), pending.end(), requestId);
  if (found == pending.end()) return false;
  pending.erase(found);
  return true;
}

std::wstring EventJson(
    ICoreWebView2DevToolsProtocolEventReceivedEventArgs* args) {
  if (!args) return {};
  LPWSTR raw = nullptr;
  if (FAILED(args->get_ParameterObjectAsJson(&raw)) || !raw) return {};
  std::wstring json(raw);
  CoTaskMemFree(raw);
  return json;
}

void RequestStatsBody(ICoreWebView2* webview, std::wstring_view requestId) {
  if (!webview || requestId.empty()) return;
  const std::wstring parameters =
      L"{\"requestId\":" + JsonQuote(std::wstring(requestId)) + L"}";
  webview->CallDevToolsProtocolMethod(
      L"Network.getResponseBody", parameters.c_str(),
      Callback<ICoreWebView2CallDevToolsProtocolMethodCompletedHandler>(
          [](HRESULT result, LPCWSTR resultJson) -> HRESULT {
            if (FAILED(result) || !resultJson || !*resultJson) return S_OK;
            try {
              const auto response =
                  winrt::Windows::Data::Json::JsonObject::Parse(resultJson);
              if (response.GetNamedBoolean(L"base64Encoded", false)) return S_OK;
              const std::wstring bodyWide =
                  response.GetNamedString(L"body", L"").c_str();
              if (bodyWide.empty()) return S_OK;
              const std::string body = WideToUtf8(bodyWide);
              if (body.empty() || body.size() > kMaximumBodyBytes) return S_OK;
              const int64_t receivedAt = UnixMillis();
              std::vector<StationheadNativeDailyPlayPoint> daily;
              if (!ParseStatsJson(body, receivedAt, daily)) return S_OK;
              StatsStore().Publish(std::move(daily), receivedAt);
            } catch (...) {
            }
            return S_OK;
          }).Get());
}

void AttachResponseObserver(
    ICoreWebView2* webview,
    int channelId,
    const std::shared_ptr<PendingRequestIds>& pending) {
  ComPtr<ICoreWebView2DevToolsProtocolEventReceiver> receiver;
  if (FAILED(webview->GetDevToolsProtocolEventReceiver(
          L"Network.responseReceived", &receiver)) || !receiver) {
    return;
  }
  EventRegistrationToken ignoredToken{};
  receiver->add_DevToolsProtocolEventReceived(
      Callback<ICoreWebView2DevToolsProtocolEventReceivedEventHandler>(
          [channelId, pending](
              ICoreWebView2*,
              ICoreWebView2DevToolsProtocolEventReceivedEventArgs* args)
              -> HRESULT {
            try {
              const std::wstring eventJson = EventJson(args);
              if (eventJson.empty()) return S_OK;
              const auto event =
                  winrt::Windows::Data::Json::JsonObject::Parse(eventJson);
              const std::wstring requestId =
                  event.GetNamedString(L"requestId", L"").c_str();
              const auto response = event.GetNamedObject(L"response");
              const std::wstring url =
                  response.GetNamedString(L"url", L"").c_str();
              const double status = response.GetNamedNumber(L"status", 0);
              if (status >= 200 && status < 300 &&
                  IsStatsUri(url, channelId)) {
                RememberPendingRequest(*pending, requestId);
              }
            } catch (...) {
            }
            return S_OK;
          }).Get(),
      &ignoredToken);
}

void AttachLoadingFinishedObserver(
    ICoreWebView2* webview,
    const std::shared_ptr<PendingRequestIds>& pending) {
  ComPtr<ICoreWebView2DevToolsProtocolEventReceiver> receiver;
  if (FAILED(webview->GetDevToolsProtocolEventReceiver(
          L"Network.loadingFinished", &receiver)) || !receiver) {
    return;
  }
  EventRegistrationToken ignoredToken{};
  receiver->add_DevToolsProtocolEventReceived(
      Callback<ICoreWebView2DevToolsProtocolEventReceivedEventHandler>(
          [pending](
              ICoreWebView2* sender,
              ICoreWebView2DevToolsProtocolEventReceivedEventArgs* args)
              -> HRESULT {
            try {
              const std::wstring eventJson = EventJson(args);
              if (eventJson.empty()) return S_OK;
              const auto event =
                  winrt::Windows::Data::Json::JsonObject::Parse(eventJson);
              const std::wstring requestId =
                  event.GetNamedString(L"requestId", L"").c_str();
              if (!TakePendingRequest(*pending, requestId)) return S_OK;
              RequestStatsBody(sender, requestId);
            } catch (...) {
            }
            return S_OK;
          }).Get(),
      &ignoredToken);
}

void AttachLoadingFailedObserver(
    ICoreWebView2* webview,
    const std::shared_ptr<PendingRequestIds>& pending) {
  ComPtr<ICoreWebView2DevToolsProtocolEventReceiver> receiver;
  if (FAILED(webview->GetDevToolsProtocolEventReceiver(
          L"Network.loadingFailed", &receiver)) || !receiver) {
    return;
  }
  EventRegistrationToken ignoredToken{};
  receiver->add_DevToolsProtocolEventReceived(
      Callback<ICoreWebView2DevToolsProtocolEventReceivedEventHandler>(
          [pending](
              ICoreWebView2*,
              ICoreWebView2DevToolsProtocolEventReceivedEventArgs* args)
              -> HRESULT {
            try {
              const std::wstring eventJson = EventJson(args);
              if (eventJson.empty()) return S_OK;
              const auto event =
                  winrt::Windows::Data::Json::JsonObject::Parse(eventJson);
              const std::wstring requestId =
                  event.GetNamedString(L"requestId", L"").c_str();
              TakePendingRequest(*pending, requestId);
            } catch (...) {
            }
            return S_OK;
          }).Get(),
      &ignoredToken);
}

}  // namespace

void AttachStationheadNativeStats(ICoreWebView2* webview, int channelId) {
  if (!webview || channelId <= 0) return;
  const auto pending = std::make_shared<PendingRequestIds>();
  AttachResponseObserver(webview, channelId, pending);
  AttachLoadingFinishedObserver(webview, pending);
  AttachLoadingFailedObserver(webview, pending);
}

StationheadNativeStatsSnapshot GetStationheadNativeStatsSnapshot() {
  return StatsStore().Snapshot();
}

uint64_t GetStationheadNativeStatsRevision() {
  return StatsStore().Revision();
}

}  // namespace hp
