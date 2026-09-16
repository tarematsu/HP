#include "app.h"
#include "web_renderer.h"
#include "cloud_config.h"
#include "power_saving_controller.h"
#include "version.h"

namespace hp {
namespace {
constexpr wchar_t kWindowClass[] = L"HomePanelNativeWindow";
constexpr uint32_t kFastTickMs = 2000;
constexpr uint32_t kMaxAppTimerMs = 24U * 60U * 60U * 1000U;
constexpr wchar_t kStationheadAmazonProfile[] = L"spotify-v2-1";

uint32_t NextDelayFromDeadline(int64_t now, int64_t deadline, uint32_t fallbackMs) {
  if (deadline <= 0) return fallbackMs;
  if (deadline <= now) return 1;
  const int64_t delta = deadline - now;
  return static_cast<uint32_t>(std::clamp<int64_t>(delta, 1, fallbackMs));
}

}

App::App(HINSTANCE instance) : instance_(instance) { current_ = this; }

App::~App() {
  StopServices();
  if (mutex_) CloseHandle(mutex_);
  current_ = nullptr;
}

App* App::Current() { return current_; }

int App::Run(int showCommand) {
  mutex_ = CreateMutexW(nullptr, TRUE, kMutexName);
  if (!mutex_ || GetLastError() == ERROR_ALREADY_EXISTS) return 0;
  InitializePaths();
  logger_ = std::make_unique<Logger>(dataDir_ / L"homepanel.log", 2 * 1024 * 1024, 3);
  logger_->Info(L"HomePanel starting version " + std::wstring(kVersion));
  CreateMainWindow(showCommand);
  StartServices();
  MSG message{};
  int getMessageResult = 0;
  while ((getMessageResult = GetMessageW(&message, nullptr, 0, 0)) > 0) {
    TranslateMessage(&message);
    DispatchMessageW(&message);
  }
  exitCode_ = getMessageResult < 0 ? 1 : static_cast<int>(message.wParam);
  logger_->Info(L"HomePanel exiting code " + std::to_wstring(exitCode_));
  return exitCode_;
}

void App::InitializePaths() {
  wchar_t executable[MAX_PATH * 4]{};
  GetModuleFileNameW(nullptr, executable, _countof(executable));
  rootDir_ = fs::path(executable).parent_path();
  dataDir_ = rootDir_ / L"data";
  fs::create_directories(dataDir_);
  const fs::path settings = dataDir_ / L"settings.json";
  if (!fs::exists(settings) && fs::exists(rootDir_ / L"config.example.json")) {
    std::error_code ignored;
    fs::copy_file(rootDir_ / L"config.example.json", settings, fs::copy_options::skip_existing, ignored);
  }
  config_ = LoadConfig(settings);
  ApplyCloudConfig(config_, dataDir_ / L"device-config.json");
}

void App::CreateMainWindow(int showCommand) {
  SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
  WNDCLASSEXW windowClass{sizeof(windowClass)};
  windowClass.style = CS_HREDRAW | CS_VREDRAW;
  windowClass.lpfnWndProc = WindowProc;
  windowClass.hInstance = instance_;
  windowClass.hCursor = LoadCursorW(nullptr, IDC_ARROW);
  // Keep the initial hidden HWND unpainted until Renderer installs the real
  // dashboard background. A BLACK_BRUSH here can become the first DWM frame
  // before child panels have produced their initial paint.
  windowClass.hbrBackground = nullptr;
  windowClass.lpszClassName = kWindowClass;
  if (!RegisterClassExW(&windowClass) && GetLastError() != ERROR_ALREADY_EXISTS) {
    ThrowIfFailed(HRESULT_FROM_WIN32(GetLastError()), "RegisterClassEx");
  }
  RECT bounds{0, 0, config_.screenWidth, config_.screenHeight};
  HMONITOR monitor = MonitorFromPoint(POINT{0, 0}, MONITOR_DEFAULTTOPRIMARY);
  MONITORINFO info{sizeof(info)};
  if (GetMonitorInfoW(monitor, &info)) bounds = info.rcMonitor;
  window_ = CreateWindowExW(WS_EX_APPWINDOW, kWindowClass, kAppName, WS_POPUP | WS_CLIPCHILDREN,
                            bounds.left, bounds.top, bounds.right - bounds.left, bounds.bottom - bounds.top,
                            nullptr, nullptr, instance_, this);
  if (!window_) {
    const DWORD primaryError = GetLastError();
    window_ = CreateWindowExW(0, kWindowClass, kAppName, WS_OVERLAPPEDWINDOW | WS_CLIPCHILDREN,
                              CW_USEDEFAULT, CW_USEDEFAULT, config_.screenWidth, config_.screenHeight,
                              nullptr, nullptr, instance_, this);
    if (window_ && logger_) {
      std::wostringstream text;
      text << L"CreateWindowEx fallback succeeded after popup window failed: " << primaryError;
      logger_->Warn(text.str());
    }
  }
  if (!window_) {
    const DWORD error = GetLastError();
    throw std::runtime_error("CreateWindowEx failed (" + std::to_string(error) + ")");
  }
  PowerSavingController::AttachCurrent(window_);
  startupShowCommand_ = showCommand == SW_HIDE ? SW_SHOW : showCommand;
}

void App::StartServices() {
  renderer_ = std::make_unique<Renderer>(window_, config_.screenWidth, config_.screenHeight);
  if (!renderer_->LoadDashboard(dataDir_ / L"dashboard.json")) {
    logger_->Warn(L"No valid dashboard cache; local layers will remain available");
  }

  const fs::path stationheadUserData = dataDir_ / L"webview2-youtube-mv";
  auto stationheadPlayer = std::make_unique<StationheadPlayer>(
      window_, config_.stationhead, stationheadUserData, *logger_);
  stationheadPlayer->ReuseWebViewProfile(kStationheadAmazonProfile);
  stationhead_ = std::move(stationheadPlayer);
  logger_->Info(L"Single Stationhead prepared with existing amazon WebView2 profile");

  startupAt_ = UnixMillis();

  // Stage 1: initialize the native dashboard and YouTube/MV WebView immediately.
  // Spotify and Stationhead use fixed offsets from app startup. No readiness
  // confirmation is required before the next launch is issued.
  renderer_->Initialize();
  rendererStarted_ = true;
  RECT client{};
  if (GetClientRect(window_, &client) && client.right > client.left && client.bottom > client.top) {
    renderer_->Resize(client.right - client.left, client.bottom - client.top);
  }
  LayoutWorkspace();
  renderer_->TickNativePanels(startupAt_);
  logger_->Info(L"YouTube/native dashboard started; Spotify #1 at +10s, Spotify #2 at +20s, Stationhead at +30s");

  // The top-level HWND is still hidden. Prime both the parent background and
  // every visible child panel before allowing DWM to expose the window. This
  // prevents the creation-time surface from flashing ahead of the dashboard.
  renderer_->Render();
  RedrawWindow(window_, nullptr, nullptr,
               RDW_INVALIDATE | RDW_UPDATENOW | RDW_ALLCHILDREN);
  ShowWindow(window_, startupShowCommand_);
  UpdateWindow(window_);
  ScheduleNextTick(kFastTickMs);

  const std::wstring deviceToken = LoadProtectedToken(dataDir_ / L"device-token.dat", L"HOMEPANEL_DEVICE_TOKEN");
  const std::wstring actionToken = LoadProtectedToken(dataDir_ / L"action-token.dat", L"HOMEPANEL_ACTION_TOKEN");
  cloud_ = std::make_unique<CloudClient>(window_, config_, dataDir_, deviceToken, actionToken, *logger_);
  sensors_ = std::make_unique<SensorHub>(window_, config_, dataDir_, *logger_);
  sensors_->Start();
  cloud_->Start();
  cloudStarted_ = true;

  LoadAirHistory();
  const SensorSnapshot sensors = sensors_->Snapshot();
  renderer_->UpdateSensors(sensors);
  UpdateAirHistory(sensors);
  lastTelemetryAt_ = startupAt_;
  InvalidateAll();
}

void App::StartDeferredServices(int64_t now) {
  if (!rendererStarted_) {
    renderer_->Initialize();
    rendererStarted_ = true;
    LayoutWorkspace();
    renderer_->TickNativePanels(now);
    InvalidateAll();
    logger_->Warn(L"Native dashboard/YouTube started by deferred recovery");
  }

  // Stage 2: issue Spotify launch at app startup +10 seconds. Its internal
  // scheduler starts slot 1 immediately and slot 2 at +20 seconds.
  if (!spotifyStarted_ &&
      now - startupAt_ >= kMediaStartupStageDelayMs) {
    renderer_->StartSpotify();
    spotifyStarted_ = true;
    logger_->Info(L"Spotify #1 launch issued at +10 seconds; #2 follows 10 seconds later");
  }

  // Stage 3: issue Stationhead launch at app startup +30 seconds, ten seconds
  // after Spotify slot 2, regardless of Spotify readiness.
  if (!stationheadStarted_ && stationhead_ &&
      now - startupAt_ >= kMediaStartupStageDelayMs * 3) {
    stationhead_->Start();
    stationheadStarted_ = true;
    stationhead_->SetAudioMuted(stationheadAudioMuted_);
    MarkStationheadPlacementDirty();
    ApplyStationheadWindowPlacement(stationhead_->Status());
    logger_->Info(L"Stationhead launch issued at +30 seconds");
  }

  if (!cloudStarted_ && cloud_) {
    cloud_->Start();
    cloudStarted_ = true;
  }

  if (!startupUpdateScheduled_ && cloudStarted_ && now - startupAt_ >= 60'000) {
    startupUpdateScheduled_ = true;
    CheckForUpdateAsync(false);
    logger_->Info(L"Background update check started after startup-critical work");
  }
}

void App::StopServices() {
  if (window_) KillTimer(window_, kCentralTimer);
  nextAppTickAt_ = 0;
  if (stationheadStarted_ && stationhead_) stationhead_->Stop();
  if (cloud_) cloud_->Stop();
  if (sensors_) sensors_->Stop();
  if (telemetryThread_.joinable()) telemetryThread_.join();
  if (updateThread_.joinable()) updateThread_.join();
  stationhead_.reset();
  cloud_.reset();
  sensors_.reset();
  renderer_.reset();
}

void App::Tick() {
  if (!renderer_ || !sensors_ || !cloud_) return;
  const int64_t now = UnixMillis();

  StartDeferredServices(now);

  StationheadStatus stationheadStatus;
  if (stationheadStarted_ && stationhead_) {
    stationhead_->Tick(now);
    stationheadStatus = stationhead_->Status();
    ApplyStationheadWindowPlacement(stationheadStatus);
  }

  const int64_t telemetryIntervalMs =
      static_cast<int64_t>(std::max(1, config_.telemetryMinutes)) * 60'000;
  if (cloudStarted_ && now - lastTelemetryAt_ >= telemetryIntervalMs) {
    lastTelemetryAt_ = now;
    SendTelemetryAsync();
  }
  if (toastUntil_ && now >= toastUntil_) {
    toastUntil_ = 0;
    toastText_.clear();
  }

  uint32_t nextTickMs = kMaxAppTimerMs;
  if (!spotifyStarted_) {
    nextTickMs = std::min(
        nextTickMs,
        NextDelayFromDeadline(
            now, startupAt_ + kMediaStartupStageDelayMs, kMaxAppTimerMs));
  }
  if (!stationheadStarted_) {
    nextTickMs = std::min(
        nextTickMs,
        NextDelayFromDeadline(
            now, startupAt_ + static_cast<int>(kMediaStartupStageDelayMs * 3),
            kMaxAppTimerMs));
  }
  if (!startupUpdateScheduled_ && cloudStarted_) {
    nextTickMs = std::min(
        nextTickMs,
        NextDelayFromDeadline(now, startupAt_ + 60'000, kMaxAppTimerMs));
  }
  if (cloudStarted_) {
    nextTickMs = std::min(
        nextTickMs,
        NextDelayFromDeadline(
            now, lastTelemetryAt_ + telemetryIntervalMs, kMaxAppTimerMs));
  }
  if (rendererStarted_) {
    nextTickMs = std::min(
        nextTickMs,
        NextDelayFromDeadline(
            now, renderer_->NativePlaybackNextWakeAt(now), kMaxAppTimerMs));
  }
  if (stationheadStarted_ && stationhead_) {
    // Until Stationhead has established audio, keep the App scheduler alive at
    // the fast cadence even while the WebView stays behind the dashboard. This
    // makes Start Listening retries independent of monitor-B/foreground wakes.
    if (StationheadNeedsForeground(stationheadStatus) ||
        !stationheadStatus.audioPlaying) {
      nextTickMs = std::min(nextTickMs, kFastTickMs);
    } else {
      nextTickMs = std::min(
          nextTickMs,
          NextDelayFromDeadline(now, stationhead_->NextWakeAt(), kMaxAppTimerMs));
    }
  }
  if (toastUntil_ > 0) {
    nextTickMs = std::min(
        nextTickMs,
        NextDelayFromDeadline(now, toastUntil_, kMaxAppTimerMs));
  }
  ScheduleNextTick(nextTickMs);
}

void App::Draw() {
  PAINTSTRUCT paint{};
  BeginPaint(window_, &paint);
  if (renderer_ && rendererStarted_) renderer_->Render();
  EndPaint(window_, &paint);
}

void App::ShowToast(std::wstring message, int64_t durationMs, bool invalidate) {
  toastText_ = std::move(message);
  toastUntil_ = durationMs > 0 ? UnixMillis() + durationMs : 0;
  if (durationMs > 0) {
    ScheduleNextTick(static_cast<uint32_t>(std::clamp<int64_t>(
        durationMs, 1, kMaxAppTimerMs)));
  }
  if (invalidate) InvalidateAll();
}

void App::LayoutWorkspace() {
  if (!renderer_) return;
  RECT client{};
  GetClientRect(window_, &client);
  workspaceBounds_ = client;
  selectedTab_ = WorkspaceTab::Main;
  renderer_->SetBounds(workspaceBounds_);
  renderer_->SetVisible(rendererStarted_);
  MarkStationheadPlacementDirty();
  if (stationheadStarted_ && stationhead_) {
    ApplyStationheadWindowPlacement(stationhead_->Status());
  }
  InvalidateAll();
}

void App::ApplyStationheadWindowPlacement(const StationheadStatus& status) {
  if (!stationheadStarted_ || !stationhead_ || selectedTab_ != WorkspaceTab::Main) return;
  RECT bounds = workspaceBounds_;
  if (bounds.right <= bounds.left || bounds.bottom <= bounds.top) return;

  const bool pending = !status.audioPlaying;
  if (!stationheadPlacementDirty_ && pending == placedPrimaryPending_ &&
      EqualRect(&bounds, &placedBounds_)) {
    return;
  }
  stationheadPlacementDirty_ = false;
  placedPrimaryPending_ = pending;
  placedBounds_ = bounds;
  stationhead_->SetBounds(bounds);
  stationhead_->RefreshVisibility();
}

void App::ScheduleNextTick(uint32_t milliseconds) {
  if (!window_) return;
  const uint32_t clamped = std::max<uint32_t>(1, milliseconds);
  const uint64_t nowTick = GetTickCount64();
  const uint64_t dueTick = nowTick > static_cast<uint64_t>(INT64_MAX) - clamped
      ? static_cast<uint64_t>(INT64_MAX)
      : nowTick + clamped;
  if (nextAppTickAt_ > static_cast<int64_t>(nowTick) &&
      static_cast<uint64_t>(nextAppTickAt_) <= dueTick) {
    return;
  }
  KillTimer(window_, kCentralTimer);
  if (SetTimer(window_, kCentralTimer, clamped, nullptr) != 0) {
    nextAppTickAt_ = static_cast<int64_t>(dueTick);
  } else {
    nextAppTickAt_ = 0;
  }
}

void App::InvalidateAll() {
  ::InvalidateRect(window_, nullptr, FALSE);
}

void App::HandleAction(UiAction action) {
  switch (action) {
    case UiAction::AppUpdate:
      CheckForUpdateAsync(true);
      break;
    case UiAction::Restart:
      exitCode_ = kRestartExitCode;
      DestroyWindow(window_);
      break;
    case UiAction::StationheadAudioToggle:
      if (stationhead_) {
        stationheadAudioMuted_ = !stationheadAudioMuted_;
        stationhead_->SetAudioMuted(stationheadAudioMuted_);
      }
      break;
    case UiAction::StationheadAudioMute:
      stationheadAudioMuted_ = true;
      if (stationhead_) stationhead_->SetAudioMuted(true);
      break;
    case UiAction::None:
    default:
      break;
  }
}

void App::LogUnhandled(DWORD code, void* address) {
  if (logger_) {
    std::wostringstream text;
    text << L"Unhandled exception 0x" << std::hex << code << L" at " << address;
    logger_->Error(text.str());
  }
}
}  // namespace hp