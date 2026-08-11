#include "stationhead_native_stats.h"

#include "winhttp_helpers.h"
#include <condition_variable>
#include <deque>
#include <thread>
#include <winrt/Windows.Data.Json.h>

namespace hp {
namespace {

constexpr int64_t kDayMs = 24LL * 60 * 60 * 1000;
constexpr int64_t kHistorySampleBucketMs = 5LL * 60 * 1000;
constexpr auto kSuccessInterval = std::chrono::minutes(5);
constexpr auto kRetryInterval = std::chrono::seconds(30);
constexpr size_t kMaximumBodyBytes = 1024 * 1024;

std::wstring LowerAscii(std::wstring_view value) {
  std::wstring lower(value);
  std::transform(lower.begin(), lower.end(), lower.begin(), [](wchar_t ch) {
    return static_cast<wchar_t>(
        ch >= L'A' && ch <= L'Z' ? ch - L'A' + L'a' : ch);
  });
  return lower;
}

bool IsStationheadApiUri(std::wstring_view uri) {
  if (uri.empty()) return false;
  const std::wstring lower = LowerAscii(uri);
  constexpr std::wstring_view scheme = L"https://";
  if (!lower.starts_with(scheme)) return false;
  const size_t hostStart = scheme.size();
  const size_t pathStart = lower.find(L'/', hostStart);
  if (pathStart == std::wstring::npos) return false;
  return std::wstring_view(lower).substr(hostStart, pathStart - hostStart) ==
      L"production1.stationhead.com";
}

bool IsStatsUri(std::wstring_view uri, int channelId) {
  if (channelId <= 0 || !IsStationheadApiUri(uri)) return false;
  const std::wstring lower = LowerAscii(uri);
  constexpr size_t schemeLength = std::wstring_view(L"https://").size();
  const size_t pathStart = lower.find(L'/', schemeLength);
  if (pathStart == std::wstring::npos) return false;
  size_t pathEnd = lower.find_first_of(L"?#", pathStart);
  if (pathEnd == std::wstring::npos) pathEnd = lower.size();
  std::wstring expected = L"/me/channel/";
  expected += std::to_wstring(channelId);
  expected += L"/streakstats";
  return std::wstring_view(lower).substr(pathStart, pathEnd - pathStart) ==
      expected;
}

bool ReadBoundedStream(IStream* stream, std::string& output) {
  output.clear();
  if (!stream) return false;
  std::array<char, 4 * 1024> buffer{};
  while (output.size() < kMaximumBodyBytes) {
    ULONG read = 0;
    const ULONG capacity = static_cast<ULONG>(std::min(
        buffer.size(), kMaximumBodyBytes - output.size()));
    const HRESULT result = stream->Read(buffer.data(), capacity, &read);
    if (FAILED(result)) return false;
    if (read == 0) return !output.empty();
    output.append(buffer.data(), static_cast<size_t>(read));
    if (result == S_FALSE) break;
  }
  return !output.empty() && output.size() <= kMaximumBodyBytes;
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

struct RequestCredentials {
  std::wstring authorization;
  std::wstring deviceUid;
  std::wstring appPlatform;
  std::wstring appVersion;
  std::wstring cookie;

  bool operator==(const RequestCredentials&) const = default;
};

bool SafeHeaderValue(std::wstring_view value, size_t maximumLength) {
  return !value.empty() && value.size() <= maximumLength &&
      value.find_first_of(L"\r\n") == std::wstring_view::npos;
}

std::wstring HeaderValue(
    ICoreWebView2HttpRequestHeaders* headers,
    const wchar_t* name,
    size_t maximumLength) {
  if (!headers || !name) return {};
  LPWSTR raw = nullptr;
  if (FAILED(headers->GetHeader(name, &raw)) || !raw) return {};
  std::wstring value(raw);
  CoTaskMemFree(raw);
  return SafeHeaderValue(value, maximumLength) ? value : std::wstring{};
}

std::wstring RequestHeaders(const RequestCredentials& credentials) {
  std::wstring output;
  const auto append = [&output](
      std::wstring_view name, std::wstring_view value) {
    if (value.empty()) return;
    output.append(name);
    output.append(L": ");
    output.append(value);
    output.append(L"\r\n");
  };
  append(L"Authorization", credentials.authorization);
  append(L"sth-device-uid", credentials.deviceUid);
  append(L"app-platform", credentials.appPlatform);
  append(L"app-version", credentials.appVersion);
  append(L"Cookie", credentials.cookie);
  append(L"Accept", L"application/json");
  return output;
}

class NativeStatsClient {
 public:
  NativeStatsClient() {
    std::thread([this] { WorkerLoop(); }).detach();
  }

  void ObserveCredentials(int channelId, RequestCredentials credentials) {
    if (channelId <= 0 || credentials.authorization.empty()) return;
    {
      std::lock_guard lock(mutex_);
      if (channelId_ == channelId && credentials_ == credentials) return;
      channelId_ = channelId;
      credentials_ = std::move(credentials);
      ++credentialsGeneration_;
      nextAttempt_ = std::chrono::steady_clock::time_point::min();
    }
    wake_.notify_one();
  }

 private:
  void WorkerLoop() noexcept {
    try {
      winrt::init_apartment(winrt::apartment_type::multi_threaded);
    } catch (...) {
    }
    for (;;) {
      try {
        DownloadOnce();
      } catch (...) {
        std::lock_guard lock(mutex_);
        if (channelId_ > 0 && !credentials_.authorization.empty()) {
          nextAttempt_ = std::chrono::steady_clock::now() + kRetryInterval;
        }
      }
    }
  }

  void DownloadOnce() {
    int channelId = 0;
    uint64_t generation = 0;
    RequestCredentials credentials;
    {
      std::unique_lock lock(mutex_);
      wake_.wait(lock, [this] {
        return channelId_ > 0 && !credentials_.authorization.empty();
      });
      while (nextAttempt_ != std::chrono::steady_clock::time_point::min() &&
             std::chrono::steady_clock::now() < nextAttempt_) {
        wake_.wait_until(lock, nextAttempt_);
      }
      channelId = channelId_;
      generation = credentialsGeneration_;
      credentials = credentials_;
      nextAttempt_ = std::chrono::steady_clock::time_point::max();
    }

    std::wstring url = L"https://production1.stationhead.com/me/channel/";
    url += std::to_wstring(channelId);
    url += L"/streakStats";
    const std::wstring headers = RequestHeaders(credentials);
    std::vector<uint8_t> body;
    std::wstring contentType;
    std::wstring error;
    const bool downloaded = WinHttpDownload(
        url, kMaximumBodyBytes, &body, &contentType, &error,
        L"HomePanel/2.2", headers.c_str());
    const int64_t receivedAt = UnixMillis();
    std::vector<StationheadNativeDailyPlayPoint> daily;
    const bool parsed = downloaded && ParseStatsJson(
        std::string_view(
            reinterpret_cast<const char*>(body.data()), body.size()),
        receivedAt, daily);

    bool currentCredentials = false;
    {
      std::lock_guard lock(mutex_);
      currentCredentials = generation == credentialsGeneration_;
      if (currentCredentials) {
        nextAttempt_ = std::chrono::steady_clock::now() +
            (parsed ? kSuccessInterval : kRetryInterval);
      }
    }
    if (parsed && currentCredentials) {
      StatsStore().Publish(std::move(daily), receivedAt);
    }
    wake_.notify_one();
  }

  std::mutex mutex_;
  std::condition_variable wake_;
  RequestCredentials credentials_;
  int channelId_ = 0;
  uint64_t credentialsGeneration_ = 0;
  std::chrono::steady_clock::time_point nextAttempt_ =
      std::chrono::steady_clock::time_point::min();
};

NativeStatsClient& StatsClient() {
  static auto* client = new NativeStatsClient();
  return *client;
}

void AddRequestFilter(
    ICoreWebView2* webview,
    ICoreWebView2_22* sourceAwareWebView,
    COREWEBVIEW2_WEB_RESOURCE_CONTEXT context) {
  if (!webview) return;
  constexpr auto sourceKinds =
      static_cast<COREWEBVIEW2_WEB_RESOURCE_REQUEST_SOURCE_KINDS>(
          COREWEBVIEW2_WEB_RESOURCE_REQUEST_SOURCE_KINDS_DOCUMENT |
          COREWEBVIEW2_WEB_RESOURCE_REQUEST_SOURCE_KINDS_SHARED_WORKER |
          COREWEBVIEW2_WEB_RESOURCE_REQUEST_SOURCE_KINDS_SERVICE_WORKER);
  if (sourceAwareWebView &&
      SUCCEEDED(sourceAwareWebView->AddWebResourceRequestedFilterWithRequestSourceKinds(
          L"*", context, sourceKinds))) {
    return;
  }
  webview->AddWebResourceRequestedFilter(L"*", context);
}

void AttachCredentialObserver(ICoreWebView2* webview, int channelId) {
  if (!webview || channelId <= 0) return;
  ComPtr<ICoreWebView2> base = webview;
  ComPtr<ICoreWebView2_22> sourceAwareWebView;
  base.As(&sourceAwareWebView);
  AddRequestFilter(
      webview, sourceAwareWebView.Get(),
      COREWEBVIEW2_WEB_RESOURCE_CONTEXT_XML_HTTP_REQUEST);
  AddRequestFilter(
      webview, sourceAwareWebView.Get(),
      COREWEBVIEW2_WEB_RESOURCE_CONTEXT_FETCH);

  EventRegistrationToken ignoredToken{};
  webview->add_WebResourceRequested(
      Callback<ICoreWebView2WebResourceRequestedEventHandler>(
          [channelId](
              ICoreWebView2*,
              ICoreWebView2WebResourceRequestedEventArgs* args) -> HRESULT {
            if (!args) return S_OK;
            ComPtr<ICoreWebView2WebResourceRequest> request;
            if (FAILED(args->get_Request(&request)) || !request) return S_OK;
            LPWSTR uriRaw = nullptr;
            if (FAILED(request->get_Uri(&uriRaw)) || !uriRaw) return S_OK;
            const std::wstring uri(uriRaw);
            CoTaskMemFree(uriRaw);
            if (!IsStationheadApiUri(uri)) return S_OK;

            ComPtr<ICoreWebView2HttpRequestHeaders> headers;
            if (FAILED(request->get_Headers(&headers)) || !headers) return S_OK;
            RequestCredentials credentials;
            credentials.authorization = HeaderValue(
                headers.Get(), L"Authorization", 16 * 1024);
            if (credentials.authorization.empty()) return S_OK;
            credentials.deviceUid = HeaderValue(
                headers.Get(), L"sth-device-uid", 1024);
            credentials.appPlatform = HeaderValue(
                headers.Get(), L"app-platform", 256);
            credentials.appVersion = HeaderValue(
                headers.Get(), L"app-version", 256);
            credentials.cookie = HeaderValue(
                headers.Get(), L"Cookie", 32 * 1024);
            StatsClient().ObserveCredentials(channelId, std::move(credentials));
            return S_OK;
          }).Get(),
      &ignoredToken);
}

void AttachResponseObserver(ICoreWebView2* webview, int channelId) {
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
            if (!IsStatsUri(uri, channelId)) return S_OK;

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
                      if (!ReadBoundedStream(stream, body)) return S_OK;
                      const int64_t receivedAt = UnixMillis();
                      std::vector<StationheadNativeDailyPlayPoint> daily;
                      if (ParseStatsJson(body, receivedAt, daily)) {
                        StatsStore().Publish(std::move(daily), receivedAt);
                      }
                      return S_OK;
                    }).Get());
            return S_OK;
          }).Get(),
      &ignoredToken);
}

}  // namespace

void AttachStationheadNativeStats(ICoreWebView2* webview, int channelId) {
  AttachCredentialObserver(webview, channelId);
  AttachResponseObserver(webview, channelId);
}

StationheadNativeStatsSnapshot GetStationheadNativeStatsSnapshot() {
  return StatsStore().Snapshot();
}

uint64_t GetStationheadNativeStatsRevision() {
  return StatsStore().Revision();
}

}  // namespace hp