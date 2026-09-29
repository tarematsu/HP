#pragma once

#include "shared_webview_environment.h"
#include "spotify_artist_chart_capture_spool.h"
#include <winrt/Windows.Data.Json.h>
#include <ctime>

namespace hp {
namespace spotify_artist_chart_detail {

inline constexpr wchar_t kChartPageUrl[] =
    L"https://charts.spotify.com/charts/view/artist-jp-daily/latest";
inline constexpr wchar_t kChartApiPrefix[] =
    L"https://charts-spotify-com-service.spotify.com/auth/v0/charts/artist-jp-daily/";
inline constexpr int64_t kJstOffsetMs = 9 * 60 * 60'000LL;
inline constexpr int64_t kDayMs = 24 * 60 * 60'000LL;
inline constexpr int64_t kDailyCaptureOffsetMs = (7 * 60 + 20) * 60'000LL;
inline constexpr int64_t kRetryIntervalMs = 60 * 60'000LL;
inline constexpr int64_t kCaptureTimeoutMs = 90'000;
inline constexpr size_t kMaxResponseBytes = 512 * 1024;
inline constexpr size_t kReadBufferBytes = 16 * 1024;

inline bool CallbackAlive(const std::shared_ptr<std::atomic<bool>>& alive) noexcept {
  return alive && alive->load(std::memory_order_acquire);
}

inline std::wstring HResultHex(HRESULT value) {
  std::wostringstream output;
  output << L"0x" << std::hex << std::setw(8) << std::setfill(L'0')
         << static_cast<unsigned long>(value);
  return output.str();
}

inline fs::path DefaultUserDataFolder() {
  constexpr DWORD kExecutablePathChars = 32768;
  std::vector<wchar_t> executable(kExecutablePathChars, L'\0');
  const DWORD length = GetModuleFileNameW(
      nullptr, executable.data(), static_cast<DWORD>(executable.size()));
  if (length == 0 || length >= executable.size()) return {};
  return fs::path(std::wstring(executable.data(), length)).parent_path() /
      L"data" / L"webview2-youtube-mv";
}

inline int64_t JstDayStartUtc(int64_t nowMs) noexcept {
  const int64_t local = nowMs + kJstOffsetMs;
  return (local / kDayMs) * kDayMs - kJstOffsetMs;
}

inline int64_t InitialCaptureAt(int64_t nowMs) noexcept {
  const int64_t target = JstDayStartUtc(nowMs) + kDailyCaptureOffsetMs;
  return nowMs < target ? target : nowMs + 30'000;
}

inline int64_t NextDailyCaptureAt(int64_t nowMs) noexcept {
  return JstDayStartUtc(nowMs) + kDayMs + kDailyCaptureOffsetMs;
}

inline std::string JstPreviousDateKey(int64_t nowMs) {
  const std::time_t seconds = static_cast<std::time_t>(
      (nowMs + kJstOffsetMs - kDayMs) / 1000);
  std::tm value{};
  gmtime_s(&value, &seconds);
  char buffer[16]{};
  std::strftime(buffer, sizeof(buffer), "%Y-%m-%d", &value);
  return buffer;
}

inline bool IsIsoDateAt(std::string_view value, size_t offset) noexcept {
  if (offset + 10 > value.size()) return false;
  const auto digit = [&](size_t index) {
    const char ch = value[offset + index];
    return ch >= '0' && ch <= '9';
  };
  return digit(0) && digit(1) && digit(2) && digit(3) &&
      value[offset + 4] == '-' && digit(5) && digit(6) &&
      value[offset + 7] == '-' && digit(8) && digit(9);
}

inline std::string FindDateAfterJsonKey(std::string_view value, std::string_view key) {
  size_t position = value.find(key);
  while (position != std::string_view::npos) {
    const size_t colon = value.find(':', position + key.size());
    if (colon == std::string_view::npos) break;
    const size_t quote = value.find('"', colon + 1);
    if (quote != std::string_view::npos && IsIsoDateAt(value, quote + 1)) {
      return std::string(value.substr(quote + 1, 10));
    }
    position = value.find(key, position + key.size());
  }
  return {};
}

inline std::string FindChartDate(std::string_view value) {
  for (const std::string_view key : {
           std::string_view{"\"chartDate\""},
           std::string_view{"\"displayDate\""},
           std::string_view{"\"latestDate\""},
           std::string_view{"\"date\""},
       }) {
    if (const std::string found = FindDateAfterJsonKey(value, key); !found.empty()) {
      return found;
    }
  }
  for (size_t offset = 0; offset + 10 <= value.size(); ++offset) {
    if (IsIsoDateAt(value, offset)) return std::string(value.substr(offset, 10));
  }
  return {};
}

inline std::string ReadStreamUtf8(IStream* stream) {
  if (!stream) return {};
  std::string output;
  output.reserve(64 * 1024);
  std::vector<char> buffer(kReadBufferBytes);
  while (output.size() <= kMaxResponseBytes) {
    ULONG read = 0;
    const HRESULT result = stream->Read(
        buffer.data(), static_cast<ULONG>(buffer.size()), &read);
    if (FAILED(result)) return {};
    if (read == 0) break;
    if (output.size() + read > kMaxResponseBytes) return {};
    output.append(buffer.data(), static_cast<size_t>(read));
  }
  return output;
}

inline std::optional<double> JsonNumber(
    const winrt::Windows::Data::Json::JsonObject& object, const wchar_t* key) {
  using winrt::Windows::Data::Json::JsonValueType;
  if (!object.HasKey(key)) return std::nullopt;
  const auto value = object.GetNamedValue(key);
  if (!value || value.ValueType() != JsonValueType::Number) return std::nullopt;
  return value.GetNumber();
}

inline std::wstring JsonString(
    const winrt::Windows::Data::Json::JsonObject& object, const wchar_t* key) {
  using winrt::Windows::Data::Json::JsonValueType;
  if (!object.HasKey(key)) return {};
  const auto value = object.GetNamedValue(key);
  if (!value || value.ValueType() != JsonValueType::String) return {};
  return value.GetString().c_str();
}

inline bool TryJsonObject(
    const winrt::Windows::Data::Json::JsonObject& source,
    const wchar_t* key,
    winrt::Windows::Data::Json::JsonObject& output) {
  using winrt::Windows::Data::Json::JsonValueType;
  if (!source.HasKey(key)) return false;
  const auto value = source.GetNamedValue(key);
  if (!value || value.ValueType() != JsonValueType::Object) return false;
  output = value.GetObject();
  return true;
}

inline std::wstring ArtistIdFromUri(std::wstring_view uri) {
  constexpr std::wstring_view prefix = L"spotify:artist:";
  const size_t spotify = uri.find(prefix);
  if (spotify != std::wstring_view::npos) {
    return std::wstring(uri.substr(spotify + prefix.size()));
  }
  constexpr std::wstring_view path = L"/artist/";
  const size_t web = uri.find(path);
  if (web == std::wstring_view::npos) return {};
  std::wstring id(uri.substr(web + path.size()));
  const size_t separator = id.find_first_of(L"/?#");
  if (separator != std::wstring::npos) id.resize(separator);
  return id;
}

inline bool NormalizeChartResponse(std::string_view body, int64_t observedAt,
                                   std::wstring* serialized) {
  using namespace winrt::Windows::Data::Json;
  if (!serialized || body.empty()) return false;
  JsonObject root;
  try {
    root = JsonObject::Parse(Utf8ToWide(std::string(body)));
  } catch (...) {
    return false;
  }
  if (!root.HasKey(L"entries") ||
      root.GetNamedValue(L"entries").ValueType() != JsonValueType::Array) {
    return false;
  }

  JsonArray normalized;
  const JsonArray entries = root.GetNamedArray(L"entries");
  for (uint32_t index = 0; index < entries.Size() && normalized.Size() < 200; ++index) {
    const auto raw = entries.GetAt(index);
    if (!raw || raw.ValueType() != JsonValueType::Object) continue;
    const JsonObject entry = raw.GetObject();
    JsonObject chart;
    if (!TryJsonObject(entry, L"chartEntryData", chart)) continue;
    const auto rankValue = JsonNumber(chart, L"currentRank");
    if (!rankValue || *rankValue < 1 || *rankValue > 200 ||
        std::trunc(*rankValue) != *rankValue) continue;

    JsonObject metadata;
    if (!TryJsonObject(entry, L"artistMetadata", metadata) &&
        !TryJsonObject(entry, L"metadata", metadata) &&
        !TryJsonObject(entry, L"trackMetadata", metadata)) continue;
    std::wstring artistName = JsonString(metadata, L"artistName");
    if (artistName.empty()) artistName = JsonString(metadata, L"name");
    if (artistName.empty()) artistName = JsonString(metadata, L"displayName");
    if (artistName.empty()) continue;
    if (artistName.size() > 240) artistName.resize(240);

    std::wstring artistUri = JsonString(metadata, L"artistUri");
    if (artistUri.empty()) artistUri = JsonString(metadata, L"uri");
    std::wstring artistId = ArtistIdFromUri(artistUri);
    if (artistId.size() > 80) artistId.resize(80);

    JsonObject row;
    row.Insert(L"rank", JsonValue::CreateNumberValue(*rankValue));
    row.Insert(L"artist_name", JsonValue::CreateStringValue(winrt::hstring(artistName)));
    if (!artistId.empty()) {
      row.Insert(L"artist_id", JsonValue::CreateStringValue(winrt::hstring(artistId)));
    }
    const auto previous = JsonNumber(chart, L"previousRank");
    if (previous && *previous >= 1 && *previous <= 200) {
      row.Insert(L"previous_rank", JsonValue::CreateNumberValue(*previous));
    }
    const auto peak = JsonNumber(chart, L"peakRank");
    if (peak && *peak >= 1 && *peak <= 200) {
      row.Insert(L"peak_rank", JsonValue::CreateNumberValue(*peak));
    }
    auto streak = JsonNumber(chart, L"consecutiveAppearancesOnChart");
    if (!streak) streak = JsonNumber(chart, L"appearancesOnChart");
    if (streak && *streak >= 0) {
      row.Insert(L"streak", JsonValue::CreateNumberValue(*streak));
    }
    normalized.Append(row);
  }

  if (normalized.Size() < 50) return false;
  const std::string chartDate = FindChartDate(body);
  if (chartDate.empty() || chartDate < JstPreviousDateKey(observedAt)) return false;

  JsonObject capture;
  capture.Insert(L"schema", JsonValue::CreateNumberValue(1));
  capture.Insert(L"observed_at", JsonValue::CreateNumberValue(static_cast<double>(observedAt)));
  capture.Insert(L"source", JsonValue::CreateStringValue(L"spotify-charts-webview"));
  capture.Insert(L"chart_id", JsonValue::CreateStringValue(L"artist-jp-daily"));
  capture.Insert(L"chart_date", JsonValue::CreateStringValue(winrt::hstring(Utf8ToWide(chartDate))));
  capture.Insert(L"entry_count", JsonValue::CreateNumberValue(normalized.Size()));
  capture.Insert(L"entries", normalized);
  *serialized = capture.Stringify().c_str();
  return true;
}

inline void DebugLog(std::wstring_view text) noexcept {
  std::wstring message = L"[SpotifyArtistChart] ";
  message.append(text);
  message.append(L"\n");
  OutputDebugStringW(message.c_str());
}

}  // namespace spotify_artist_chart_detail

inline SpotifyArtistChartCollector::~SpotifyArtistChartCollector() { Stop(); }

inline void SpotifyArtistChartCollector::EnsureStarted(int64_t nowMs) {
  if (!started_) Start(nowMs);
}

inline void SpotifyArtistChartCollector::Start(int64_t nowMs) {
  if (started_) return;
  window_ = FindWindowW(L"HomePanelNativeWindow", nullptr);
  userDataFolder_ = spotify_artist_chart_detail::DefaultUserDataFolder();
  if (!window_ || userDataFolder_.empty()) return;
  alive_ = std::make_shared<std::atomic<bool>>(true);
  started_ = true;
  creating_ = false;
  captureInFlight_ = false;
  contentInFlight_ = false;
  teardownPending_ = false;
  teardownAt_ = 0;
  nextCaptureAt_ = spotify_artist_chart_detail::InitialCaptureAt(nowMs);
  timeoutAt_ = 0;
  UpdateNextWake();
  spotify_artist_chart_detail::DebugLog(L"scheduled for 07:20 JST");
}

inline void SpotifyArtistChartCollector::Stop() {
  if (alive_) alive_->store(false, std::memory_order_release);
  started_ = false;
  creating_ = false;
  captureInFlight_ = false;
  contentInFlight_ = false;
  teardownPending_ = false;
  teardownAt_ = 0;
  ++generation_;
  CloseController();
  environment_.Reset();
  nextCaptureAt_ = 0;
  timeoutAt_ = 0;
  nextWakeAt_ = 0;
}

inline void SpotifyArtistChartCollector::Tick(int64_t nowMs) {
  if (!started_) return;

  if (teardownPending_) {
    if (teardownAt_ > nowMs) {
      UpdateNextWake();
      return;
    }
    teardownPending_ = false;
    teardownAt_ = 0;
    CloseController();
    environment_.Reset();
  }

  if ((creating_ || captureInFlight_) && timeoutAt_ > 0 && nowMs >= timeoutAt_) {
    FailCapture(nowMs, L"capture-timeout");
    return;
  }
  if (!creating_ && !captureInFlight_ && !teardownPending_ &&
      nextCaptureAt_ > 0 && nowMs >= nextCaptureAt_) {
    BeginCapture(nowMs);
    return;
  }
  UpdateNextWake();
}

inline void SpotifyArtistChartCollector::BeginCapture(int64_t nowMs) {
  using namespace spotify_artist_chart_detail;
  if (!started_ || creating_ || captureInFlight_ || teardownPending_) return;
  nextCaptureAt_ = 0;
  timeoutAt_ = nowMs + kCaptureTimeoutMs;
  captureInFlight_ = true;
  contentInFlight_ = false;
  ++generation_;
  CloseController();
  environment_.Reset();
  creating_ = true;
  const uint64_t generation = generation_;
  const auto alive = alive_;
  UpdateNextWake();
  SharedWebViewEnvironment::Instance().Acquire(
      userDataFolder_,
      [this, alive, generation](HRESULT result, ICoreWebView2Environment* environment) {
        if (!CallbackAlive(alive) || !started_ || generation != generation_) return;
        if (FAILED(result) || !environment) {
          FailCapture(UnixMillis(), L"environment-create-failed:" + HResultHex(result));
          return;
        }
        environment_ = environment;
        CreateController(generation);
      });
}

inline HRESULT SpotifyArtistChartCollector::CreateProfileController(
    ICoreWebView2CreateCoreWebView2ControllerCompletedHandler* handler) const noexcept {
  if (!environment_ || !window_ || !handler || profileName_.empty()) return E_INVALIDARG;
  ComPtr<ICoreWebView2Environment10> environment10;
  HRESULT result = environment_.As(&environment10);
  if (FAILED(result) || !environment10) return E_NOINTERFACE;
  ComPtr<ICoreWebView2ControllerOptions> options;
  result = environment10->CreateCoreWebView2ControllerOptions(&options);
  if (FAILED(result) || !options) return FAILED(result) ? result : E_FAIL;
  if (FAILED(result = options->put_ProfileName(profileName_.c_str()))) return result;
  if (FAILED(result = options->put_IsInPrivateModeEnabled(FALSE))) return result;
  return environment10->CreateCoreWebView2ControllerWithOptions(window_, options.Get(), handler);
}

inline void SpotifyArtistChartCollector::CreateController(uint64_t generation) {
  using namespace spotify_artist_chart_detail;
  if (!started_ || generation != generation_ || !environment_) return;
  const auto alive = alive_;
  const HRESULT started = CreateProfileController(
      Callback<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler>(
          [this, alive, generation](HRESULT result, ICoreWebView2Controller* controller) -> HRESULT {
            if (!CallbackAlive(alive) || !started_ || generation != generation_) {
              if (controller) controller->Close();
              return S_OK;
            }
            creating_ = false;
            if (FAILED(result) || !controller) {
              FailCapture(UnixMillis(), L"controller-create-failed:" + HResultHex(result));
              return S_OK;
            }
            controller_ = controller;
            ConfigureAndNavigate(generation);
            return S_OK;
          }).Get());
  if (FAILED(started)) {
    creating_ = false;
    FailCapture(UnixMillis(), L"controller-create-start-failed:" + HResultHex(started));
  }
}

inline void SpotifyArtistChartCollector::ConfigureAndNavigate(uint64_t generation) {
  using namespace spotify_artist_chart_detail;
  if (!started_ || generation != generation_ || !controller_) return;
  RECT bounds{0, 0, 1, 1};
  controller_->put_Bounds(bounds);
  controller_->put_IsVisible(FALSE);
  if (FAILED(controller_->get_CoreWebView2(&webview_)) || !webview_) {
    FailCapture(UnixMillis(), L"webview-unavailable");
    return;
  }

  const auto alive = alive_;
  if (FAILED(webview_->add_NavigationCompleted(
      Callback<ICoreWebView2NavigationCompletedEventHandler>(
          [this, alive, generation](ICoreWebView2*, ICoreWebView2NavigationCompletedEventArgs* args) -> HRESULT {
            if (!CallbackAlive(alive) || !started_ || generation != generation_ || !args) return S_OK;
            BOOL success = FALSE;
            if (FAILED(args->get_IsSuccess(&success)) || success == FALSE) {
              FailCapture(UnixMillis(), L"navigation-failed");
            }
            return S_OK;
          }).Get(), &navigationToken_))) {
    FailCapture(UnixMillis(), L"navigation-handler-failed");
    return;
  }

  ComPtr<ICoreWebView2_2> webview2;
  if (FAILED(webview_.As(&webview2)) || !webview2) {
    FailCapture(UnixMillis(), L"web-resource-response-api-unavailable");
    return;
  }
  const HRESULT responseHandler = webview2->add_WebResourceResponseReceived(
      Callback<ICoreWebView2WebResourceResponseReceivedEventHandler>(
          [this, alive, generation](ICoreWebView2*, ICoreWebView2WebResourceResponseReceivedEventArgs* args) -> HRESULT {
            if (!CallbackAlive(alive) || !started_ || generation != generation_ ||
                !captureInFlight_ || !args) return S_OK;
            ComPtr<ICoreWebView2WebResourceRequest> request;
            if (FAILED(args->get_Request(&request)) || !request) return S_OK;
            LPWSTR rawUri = nullptr;
            if (FAILED(request->get_Uri(&rawUri)) || !rawUri) return S_OK;
            const std::wstring uri(rawUri);
            CoTaskMemFree(rawUri);
            if (!std::wstring_view(uri).starts_with(kChartApiPrefix)) return S_OK;

            ComPtr<ICoreWebView2WebResourceResponseView> response;
            if (FAILED(args->get_Response(&response)) || !response) return S_OK;
            int status = 0;
            response->get_StatusCode(&status);
            if (status == 401 || status == 403) {
              FailCapture(UnixMillis(), L"spotify-charts-auth-required");
              return S_OK;
            }
            if (status != 200 || contentInFlight_) return S_OK;
            contentInFlight_ = true;
            const ComPtr<ICoreWebView2WebResourceResponseView> heldResponse = response;
            const HRESULT contentStarted = response->GetContent(
                Callback<ICoreWebView2WebResourceResponseViewGetContentCompletedHandler>(
                    [this, alive, generation, heldResponse](HRESULT result, IStream* content) -> HRESULT {
                      (void)heldResponse;
                      if (!CallbackAlive(alive) || !started_ || generation != generation_) return S_OK;
                      contentInFlight_ = false;
                      if (FAILED(result) || !content) {
                        FailCapture(UnixMillis(), L"chart-response-content-failed");
                        return S_OK;
                      }
                      const std::string body = ReadStreamUtf8(content);
                      std::wstring normalized;
                      const int64_t now = UnixMillis();
                      if (!NormalizeChartResponse(body, now, &normalized)) {
                        FailCapture(now, L"chart-response-invalid-or-stale");
                        return S_OK;
                      }
                      if (!spotify_artist_chart_capture_spool::Append(normalized)) {
                        FailCapture(now, L"chart-spool-write-failed");
                        return S_OK;
                      }
                      CompleteCapture(now);
                      return S_OK;
                    }).Get());
            if (FAILED(contentStarted)) {
              contentInFlight_ = false;
              FailCapture(UnixMillis(), L"chart-response-content-start-failed");
            }
            return S_OK;
          }).Get(), &responseToken_);
  if (FAILED(responseHandler)) {
    FailCapture(UnixMillis(), L"response-handler-failed:" + HResultHex(responseHandler));
    return;
  }
  responseHandlerRegistered_ = true;
  const HRESULT navigate = webview_->Navigate(kChartPageUrl);
  if (FAILED(navigate)) FailCapture(UnixMillis(), L"navigate-failed:" + HResultHex(navigate));
}

inline void SpotifyArtistChartCollector::CompleteCapture(int64_t nowMs) {
  ++generation_;
  captureInFlight_ = false;
  contentInFlight_ = false;
  creating_ = false;
  timeoutAt_ = 0;
  nextCaptureAt_ = spotify_artist_chart_detail::NextDailyCaptureAt(nowMs);
  ScheduleControllerTeardown(nowMs);
  UpdateNextWake();
  spotify_artist_chart_detail::DebugLog(L"captured and queued for R2 upload");
}

inline void SpotifyArtistChartCollector::FailCapture(int64_t nowMs, std::wstring_view reason) {
  ++generation_;
  captureInFlight_ = false;
  contentInFlight_ = false;
  creating_ = false;
  timeoutAt_ = 0;
  nextCaptureAt_ = nowMs + spotify_artist_chart_detail::kRetryIntervalMs;
  ScheduleControllerTeardown(nowMs);
  UpdateNextWake();
  spotify_artist_chart_detail::DebugLog(std::wstring(L"capture failed: ") + std::wstring(reason));
}

inline void SpotifyArtistChartCollector::ScheduleControllerTeardown(int64_t nowMs) noexcept {
  teardownPending_ = true;
  teardownAt_ = std::max<int64_t>(1, nowMs);
  debugController_ = nullptr;
  debugVisible_ = false;
  debugBounds_ = {};
}

inline void SpotifyArtistChartCollector::CloseController() noexcept {
  debugController_ = nullptr;
  debugVisible_ = false;
  debugBounds_ = {};
  if (webview_) {
    if (navigationToken_.value != 0) webview_->remove_NavigationCompleted(navigationToken_);
    if (responseHandlerRegistered_) {
      ComPtr<ICoreWebView2_2> webview2;
      if (SUCCEEDED(webview_.As(&webview2)) && webview2) {
        webview2->remove_WebResourceResponseReceived(responseToken_);
      }
    }
  }
  navigationToken_ = {};
  responseToken_ = {};
  responseHandlerRegistered_ = false;
  webview_.Reset();
  if (controller_) controller_->Close();
  controller_.Reset();
}

inline void SpotifyArtistChartCollector::UpdateNextWake() noexcept {
  int64_t next = 0;
  const auto include = [&](int64_t value) {
    if (value > 0 && (next == 0 || value < next)) next = value;
  };
  include(teardownAt_);
  include(nextCaptureAt_);
  include(timeoutAt_);
  nextWakeAt_ = next;
}

}  // namespace hp
