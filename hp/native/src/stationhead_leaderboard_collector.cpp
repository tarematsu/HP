#include "stationhead_leaderboard_collector.h"

#include "shared_webview_environment.h"
#include "stationhead_leaderboard_capture_spool.h"
#include "stationhead_leaderboard_diagnostics.h"
#include <winrt/Windows.Data.Json.h>

namespace hp {
namespace {
constexpr wchar_t kLeaderboardUrl[] = L"https://www.stationhead.com/leaderboard";
constexpr wchar_t kIdleUrl[] = L"about:blank";
constexpr int64_t kInitialCaptureDelayMs = 15'000;
constexpr int64_t kCaptureIntervalMs = 30 * 60'000;
constexpr int64_t kRetryIntervalMs = 5 * 60'000;
constexpr int64_t kRenderSettleMs = 2'000;
constexpr int64_t kContentPollIntervalMs = 2'000;
constexpr int64_t kCaptureTimeoutMs = 90'000;
constexpr size_t kMaxSnapshotCharacters = 28 * 1024;

bool CallbackAlive(const std::shared_ptr<std::atomic<bool>>& alive) noexcept {
  return alive && alive->load(std::memory_order_acquire);
}

std::wstring HResultHex(HRESULT value) {
  std::wostringstream output;
  output << L"0x" << std::hex << std::setw(8) << std::setfill(L'0')
         << static_cast<unsigned long>(value);
  return output.str();
}

std::wstring TrimReason(std::wstring_view reason) {
  constexpr size_t kMaximumCharacters = 240;
  return std::wstring(reason.substr(0, std::min(reason.size(), kMaximumCharacters)));
}

bool AppendCaptureRecord(std::wstring_view source, std::wstring_view page,
                         double status, std::wstring_view body) {
  using winrt::Windows::Data::Json::JsonObject;
  using winrt::Windows::Data::Json::JsonValue;

  JsonObject record;
  record.Insert(L"observed_at", JsonValue::CreateNumberValue(
      static_cast<double>(UnixMillis())));
  record.Insert(L"source", JsonValue::CreateStringValue(winrt::hstring(source)));
  record.Insert(L"page", JsonValue::CreateStringValue(winrt::hstring(page)));
  record.Insert(L"url", JsonValue::CreateStringValue(winrt::hstring(page)));
  record.Insert(L"method", JsonValue::CreateStringValue(L"GET"));
  record.Insert(L"status", JsonValue::CreateNumberValue(status));
  record.Insert(L"content_type",
                JsonValue::CreateStringValue(L"application/json"));
  record.Insert(L"body", JsonValue::CreateStringValue(winrt::hstring(body)));
  const winrt::hstring serialized = record.Stringify();
  return stationhead_leaderboard_capture_spool::Append(
      std::wstring_view(serialized.c_str(), serialized.size()));
}

}  // namespace

StationheadLeaderboardCollector::StationheadLeaderboardCollector(
    HWND window, fs::path userDataFolder, std::wstring profileName, Logger& log)
    : window_(window), userDataFolder_(std::move(userDataFolder)),
      profileName_(std::move(profileName)), log_(log) {
  stationhead_leaderboard_diagnostics::Mark("constructed");
}

StationheadLeaderboardCollector::~StationheadLeaderboardCollector() { Stop(); }

void StationheadLeaderboardCollector::Start(int64_t nowMs) {
  if (started_) return;
  stationhead_leaderboard_capture_spool::RemoveLegacyProbeSpool();
  alive_ = std::make_shared<std::atomic<bool>>(true);
  started_ = true;
  creating_ = false;
  captureInFlight_ = false;
  nextCaptureAt_ = nowMs + kInitialCaptureDelayMs;
  captureDueAt_ = 0;
  timeoutAt_ = 0;
  UpdateNextWake();
  stationhead_leaderboard_diagnostics::Mark("started", true);
  log_.Info(L"Stationhead leaderboard dedicated collector scheduled");
}

void StationheadLeaderboardCollector::Stop() {
  if (alive_) alive_->store(false, std::memory_order_release);
  started_ = false;
  creating_ = false;
  captureInFlight_ = false;
  ++generation_;
  CloseController();
  environment_.Reset();
  nextCaptureAt_ = 0;
  captureDueAt_ = 0;
  timeoutAt_ = 0;
  nextWakeAt_ = 0;
  stationhead_leaderboard_diagnostics::Mark("stopped");
}

void StationheadLeaderboardCollector::Tick(int64_t nowMs) {
  if (!started_) return;
  stationhead_leaderboard_diagnostics::MarkTick();

  if ((creating_ || controller_ || captureInFlight_) && timeoutAt_ > 0 &&
      nowMs >= timeoutAt_) {
    FailCapture(nowMs, L"capture-timeout");
    return;
  }

  if (webview_ && !captureInFlight_ && captureDueAt_ > 0 &&
      nowMs >= captureDueAt_) {
    CaptureSnapshot(nowMs, generation_);
    return;
  }

  if (!creating_ && !captureInFlight_ && nextCaptureAt_ > 0 &&
      nowMs >= nextCaptureAt_) {
    BeginCapture(nowMs);
    return;
  }

  UpdateNextWake();
}

void StationheadLeaderboardCollector::BeginCapture(int64_t nowMs) {
  if (!started_ || creating_ || captureInFlight_) return;

  nextCaptureAt_ = 0;
  captureDueAt_ = 0;
  timeoutAt_ = nowMs + kCaptureTimeoutMs;
  stationhead_leaderboard_diagnostics::Mark("capture_begin", true, true);

  if (controller_ && webview_) {
    UpdateNextWake();
    NavigateCurrent(generation_);
    return;
  }

  if (controller_ || webview_) {
    ++generation_;
    CloseController();
    environment_.Reset();
  }

  creating_ = true;
  const uint64_t generation = ++generation_;
  const auto alive = alive_;
  UpdateNextWake();

  SharedWebViewEnvironment::Instance().Acquire(
      userDataFolder_,
      [this, alive, generation](HRESULT result,
                                ICoreWebView2Environment* environment) {
        if (!CallbackAlive(alive) || !started_ || generation != generation_) return;
        if (FAILED(result) || !environment) {
          FailCapture(UnixMillis(),
                      L"environment-create-failed:" + HResultHex(result));
          return;
        }
        environment_ = environment;
        stationhead_leaderboard_diagnostics::Mark("environment_ready", true, true);
        CreateController(generation);
      });
}

HRESULT StationheadLeaderboardCollector::CreateProfileController(
    ICoreWebView2CreateCoreWebView2ControllerCompletedHandler* handler) const noexcept {
  if (!environment_ || !window_ || !handler || profileName_.empty()) {
    return E_INVALIDARG;
  }
  ComPtr<ICoreWebView2Environment10> environment10;
  HRESULT result = environment_.As(&environment10);
  if (FAILED(result) || !environment10) return E_NOINTERFACE;

  ComPtr<ICoreWebView2ControllerOptions> options;
  result = environment10->CreateCoreWebView2ControllerOptions(&options);
  if (FAILED(result) || !options) return FAILED(result) ? result : E_FAIL;
  result = options->put_ProfileName(profileName_.c_str());
  if (FAILED(result)) return result;
  result = options->put_IsInPrivateModeEnabled(FALSE);
  if (FAILED(result)) return result;
  return environment10->CreateCoreWebView2ControllerWithOptions(
      window_, options.Get(), handler);
}

void StationheadLeaderboardCollector::CreateController(uint64_t generation) {
  if (!started_ || generation != generation_ || !environment_) return;
  const auto alive = alive_;
  const HRESULT started = CreateProfileController(
      Callback<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler>(
          [this, alive, generation](HRESULT result,
                                    ICoreWebView2Controller* controller) -> HRESULT {
            if (!CallbackAlive(alive) || !started_ || generation != generation_) {
              if (controller) controller->Close();
              return S_OK;
            }
            creating_ = false;
            if (FAILED(result) || !controller) {
              FailCapture(UnixMillis(),
                          L"controller-create-failed:" + HResultHex(result));
              return S_OK;
            }
            controller_ = controller;
            stationhead_leaderboard_diagnostics::Mark("controller_ready", true, true);
            ConfigureAndNavigate(generation);
            return S_OK;
          }).Get());
  if (FAILED(started)) {
    creating_ = false;
    FailCapture(UnixMillis(),
                L"controller-create-start-failed:" + HResultHex(started));
  }
}

void StationheadLeaderboardCollector::ConfigureAndNavigate(uint64_t generation) {
  if (!started_ || generation != generation_ || !controller_) return;
  controller_->put_IsVisible(FALSE);
  RECT bounds{0, 0, 1, 1};
  controller_->put_Bounds(bounds);
  if (FAILED(controller_->get_CoreWebView2(&webview_)) || !webview_) {
    FailCapture(UnixMillis(), L"webview-unavailable");
    return;
  }
  stationhead_leaderboard_diagnostics::Mark("webview_ready", true, true);

  const auto alive = alive_;
  const HRESULT navigationHandler = webview_->add_NavigationCompleted(
      Callback<ICoreWebView2NavigationCompletedEventHandler>(
          [this, alive, generation](ICoreWebView2*,
                                    ICoreWebView2NavigationCompletedEventArgs* args)
              -> HRESULT {
            if (!CallbackAlive(alive) || !started_ || generation != generation_ ||
                !args || timeoutAt_ <= 0) {
              return S_OK;
            }
            BOOL success = FALSE;
            if (FAILED(args->get_IsSuccess(&success)) || success == FALSE) {
              FailCapture(UnixMillis(), L"navigation-failed");
              return S_OK;
            }
            const int64_t now = UnixMillis();
            captureDueAt_ = now + kRenderSettleMs;
            timeoutAt_ = now + kCaptureTimeoutMs;
            stationhead_leaderboard_diagnostics::Mark(
                "navigation_completed", true, true);
            UpdateNextWake();
            return S_OK;
          }).Get(),
      &navigationToken_);
  if (FAILED(navigationHandler)) {
    FailCapture(UnixMillis(),
                L"navigation-handler-failed:" + HResultHex(navigationHandler));
    return;
  }

  NavigateCurrent(generation);
}

void StationheadLeaderboardCollector::NavigateCurrent(uint64_t generation) {
  if (!started_ || generation != generation_ || !webview_) return;
  captureDueAt_ = 0;
  stationhead_leaderboard_diagnostics::Mark("navigating", true, true);
  webview_->Stop();
  const HRESULT navigate = webview_->Navigate(kLeaderboardUrl);
  if (FAILED(navigate)) {
    FailCapture(UnixMillis(), L"navigate-failed:" + HResultHex(navigate));
    return;
  }
  UpdateNextWake();
}

void StationheadLeaderboardCollector::CaptureSnapshot(
    int64_t nowMs, uint64_t generation) {
  if (!started_ || generation != generation_ || !webview_ || captureInFlight_) return;
  captureInFlight_ = true;
  captureDueAt_ = 0;
  UpdateNextWake();
  stationhead_leaderboard_diagnostics::Mark("snapshot_started", true, true);

  static constexpr wchar_t kSnapshotScript[] = LR"JS(
(() => {
  const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
  const bounded = (value, max) => clean(value).slice(0, max);
  const safeUrl = value => {
    try {
      const url = new URL(String(value || ''), location.href);
      return url.protocol === 'https:' ? (url.origin + url.pathname).slice(0, 320) : '';
    } catch (_) { return ''; }
  };
  const stationheadUrl = value => {
    try {
      const url = new URL(String(value || ''), location.href);
      const host = String(url.hostname || '').toLowerCase();
      if (url.protocol !== 'https:' ||
          (host !== 'stationhead.com' && !host.endsWith('.stationhead.com'))) return '';
      return (url.origin + url.pathname).slice(0, 320);
    } catch (_) { return ''; }
  };
  const rows = Array.from(document.querySelectorAll('tr,[role="row"]'))
    .slice(0, 15)
    .map(row => Array.from(row.querySelectorAll('th,td,[role="cell"],[role="gridcell"]'))
      .slice(0, 8)
      .map(cell => bounded(cell.innerText || cell.textContent, 80))
      .filter(Boolean))
    .filter(cells => cells.length > 0);
  const root = document.querySelector('main') || document.body;
  const allLines = String(root?.innerText || '')
    .split(/\n+/)
    .map(line => bounded(line, 120))
    .filter(Boolean)
    .slice(0, 800);
  const lines = allLines.slice(0, 120);
  const leaderboard = [];
  let expectedRank = 1;
  for (let index = 0; index < allLines.length && expectedRank <= 200; index += 1) {
    if (allLines[index] !== String(expectedRank)) continue;
    let host = '';
    for (let lookahead = index + 1; lookahead < Math.min(allLines.length, index + 8); lookahead += 1) {
      const match = allLines[lookahead].match(/^@([a-z0-9][a-z0-9_.-]{0,63})$/i);
      if (!match) continue;
      host = String(match[1] || '').toLowerCase();
      break;
    }
    if (!host) continue;
    leaderboard.push({ rank: expectedRank, host });
    expectedRank += 1;
  }
  const links = Array.from(root?.querySelectorAll?.('a[href]') || [])
    .slice(0, 15)
    .map(link => ({
      text: bounded(link.innerText || link.textContent, 80),
      url: stationheadUrl(link.href),
    }))
    .filter(link => link.text || link.url);
  const resource_paths = Array.from(performance.getEntriesByType('resource') || [])
    .map(entry => stationheadUrl(entry?.name || ''))
    .filter(Boolean)
    .slice(-20);
  const path = String(location.pathname || '');
  const signed_in = !/^\/sign-in(?:\/|$)/i.test(path);
  const text_ready = lines.length >= 10 && links.length >= 5;
  const leaderboard_ready = !signed_in || (
    /^\/leaderboard\/?$/i.test(path) && leaderboard.length >= 50 && text_ready
  );
  return {
    schema: 2,
    captured_at: Date.now(),
    title: bounded(document.title, 240),
    page: safeUrl(location.href),
    path: path.slice(0, 320),
    signed_in,
    leaderboard_ready,
    heading: bounded(root?.querySelector?.('h1,h2')?.innerText, 240),
    leaderboard,
    rows,
    lines,
    links,
    resource_paths,
  };
})()
)JS";

  const auto alive = alive_;
  ComPtr<ICoreWebView2> currentView = webview_;
  const HRESULT execute = webview_->ExecuteScript(
      kSnapshotScript,
      Callback<ICoreWebView2ExecuteScriptCompletedHandler>(
          [this, alive, generation, currentView](HRESULT result,
                                                 LPCWSTR resultJson) -> HRESULT {
            if (!CallbackAlive(alive) || !started_ || generation != generation_ ||
                currentView.Get() != webview_.Get()) {
              return S_OK;
            }
            captureInFlight_ = false;
            if (FAILED(result) || !resultJson) {
              FailCapture(UnixMillis(),
                          L"snapshot-execute-failed:" + HResultHex(result));
              return S_OK;
            }

            try {
              using winrt::Windows::Data::Json::JsonObject;
              const JsonObject snapshot = JsonObject::Parse(resultJson);
              stationhead_leaderboard_diagnostics::Mark(
                  "snapshot_parsed", true, true);
              const std::wstring page =
                  snapshot.GetNamedString(L"page", kLeaderboardUrl).c_str();
              const bool signedIn = snapshot.GetNamedBoolean(L"signed_in", false);
              const bool contentReady =
                  snapshot.GetNamedBoolean(L"leaderboard_ready", !signedIn);
              const int64_t now = UnixMillis();

              if (signedIn && !contentReady) {
                if (timeoutAt_ > 0 && now + kContentPollIntervalMs < timeoutAt_) {
                  captureDueAt_ = now + kContentPollIntervalMs;
                  UpdateNextWake();
                  return S_OK;
                }
                FailCapture(now, L"content-not-ready");
                return S_OK;
              }

              winrt::hstring serialized = snapshot.Stringify();
              if (serialized.size() > kMaxSnapshotCharacters) {
                JsonObject reduced = snapshot;
                reduced.Remove(L"resource_paths");
                serialized = reduced.Stringify();
                if (serialized.size() > kMaxSnapshotCharacters) {
                  reduced.Remove(L"links");
                  serialized = reduced.Stringify();
                }
                if (serialized.size() > kMaxSnapshotCharacters) {
                  reduced.Remove(L"lines");
                  serialized = reduced.Stringify();
                }
                if (serialized.size() > kMaxSnapshotCharacters) {
                  reduced.Remove(L"rows");
                  serialized = reduced.Stringify();
                }
              }
              const bool stored = AppendCaptureRecord(
                  L"dedicated-webview-dom", page, 200,
                  std::wstring_view(serialized.c_str(), serialized.size()));
              if (!stored) {
                FailCapture(UnixMillis(), L"spool-write-failed");
                return S_OK;
              }
              stationhead_leaderboard_diagnostics::Mark(
                  "spool_stored", true, true);
              log_.Info(L"Stationhead leaderboard capture stored signed_in=" +
                        std::wstring(signedIn ? L"true" : L"false"));
              CompleteCapture(UnixMillis(), signedIn);
            } catch (...) {
              FailCapture(UnixMillis(), L"snapshot-parse-failed");
            }
            return S_OK;
          }).Get());
  if (FAILED(execute)) {
    captureInFlight_ = false;
    FailCapture(nowMs, L"snapshot-start-failed:" + HResultHex(execute));
  }
}

void StationheadLeaderboardCollector::CompleteCapture(
    int64_t nowMs, bool signedIn) {
  captureInFlight_ = false;
  captureDueAt_ = 0;
  timeoutAt_ = 0;
  nextCaptureAt_ = nowMs + (signedIn ? kCaptureIntervalMs : kRetryIntervalMs);
  stationhead_leaderboard_diagnostics::Mark("completed", true, true);
  UpdateNextWake();

  // Keep the successfully-created controller/profile alive so recurring captures do
  // not repeatedly race WebView2 profile controller creation. Unload Stationhead
  // while idle to keep CPU/network use low; cookies remain in the shared profile.
  if (webview_) webview_->Navigate(kIdleUrl);
}

void StationheadLeaderboardCollector::FailCapture(
    int64_t nowMs, std::wstring_view reason) {
  const std::wstring safeReason = TrimReason(reason);
  stationhead_leaderboard_diagnostics::MarkFailure(
      stationhead_leaderboard_diagnostics::ErrorCategory(safeReason));
  try {
    using winrt::Windows::Data::Json::JsonObject;
    using winrt::Windows::Data::Json::JsonValue;
    JsonObject body;
    body.Insert(L"schema", JsonValue::CreateNumberValue(2));
    body.Insert(L"error", JsonValue::CreateStringValue(winrt::hstring(safeReason)));
    const winrt::hstring serialized = body.Stringify();
    AppendCaptureRecord(
        L"dedicated-webview-error", kLeaderboardUrl, 0,
        std::wstring_view(serialized.c_str(), serialized.size()));
  } catch (...) {
  }
  log_.Warn(L"Stationhead leaderboard capture failed: " + safeReason);

  // Invalidate every outstanding environment/controller/navigation/script callback
  // before tearing down the failed attempt. This prevents a late callback from an
  // old timed-out attempt resurrecting a controller during the next retry window.
  ++generation_;
  creating_ = false;
  captureInFlight_ = false;
  captureDueAt_ = 0;
  timeoutAt_ = 0;
  CloseController();
  environment_.Reset();
  nextCaptureAt_ = nowMs + kRetryIntervalMs;
  UpdateNextWake();
}

void StationheadLeaderboardCollector::CloseController() noexcept {
  if (webview_ && navigationToken_.value != 0) {
    webview_->remove_NavigationCompleted(navigationToken_);
  }
  navigationToken_ = {};
  webview_.Reset();
  if (controller_) controller_->Close();
  controller_.Reset();
}

void StationheadLeaderboardCollector::UpdateNextWake() noexcept {
  nextWakeAt_ = 0;
  const auto consider = [this](int64_t deadline) {
    if (deadline <= 0) return;
    if (nextWakeAt_ <= 0 || deadline < nextWakeAt_) nextWakeAt_ = deadline;
  };
  consider(nextCaptureAt_);
  consider(captureDueAt_);
  consider(timeoutAt_);
}

}  // namespace hp