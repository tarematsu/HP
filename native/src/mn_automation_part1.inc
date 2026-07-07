#include "mn_automation.h"
#include "cloud_config.h"
#include "config.h"
#include "shared_webview_environment.h"
#include <winrt/Windows.Data.Json.h>

namespace hp {
namespace {
constexpr wchar_t kProfileName[] = L"mineo-automation";
constexpr wchar_t kWindowClassName[] = L"HomePanelMineoAutomationWindow";
constexpr int64_t kProbeRetryMs = 5'000;
constexpr int64_t kUnknownRetryMs = 30'000;
constexpr int64_t kDomCaptureThrottleMs = 5'000;
constexpr int kScheduleWindowMinutes = 60;

struct MineoCredentials {
  std::wstring id;
  std::wstring password;
};

std::string TrimAscii(std::string value) {
  const auto first = value.find_first_not_of(" \t\r\n");
  if (first == std::string::npos) return {};
  const auto last = value.find_last_not_of(" \t\r\n");
  return value.substr(first, last - first + 1);
}

void ApplyDotEnvFile(const fs::path& path, MineoCredentials& credentials) {
  std::ifstream input(path, std::ios::binary);
  if (!input) return;
  std::string line;
  bool firstLine = true;
  while (std::getline(input, line)) {
    if (firstLine && line.size() >= 3 &&
        static_cast<unsigned char>(line[0]) == 0xEF &&
        static_cast<unsigned char>(line[1]) == 0xBB &&
        static_cast<unsigned char>(line[2]) == 0xBF) {
      line.erase(0, 3);
    }
    firstLine = false;
    line = TrimAscii(std::move(line));
    if (line.empty() || line.front() == '#') continue;
    if (line.rfind("export ", 0) == 0) line = TrimAscii(line.substr(7));
    const auto separator = line.find('=');
    if (separator == std::string::npos) continue;
    const std::string key = TrimAscii(line.substr(0, separator));
    std::string value = TrimAscii(line.substr(separator + 1));
    if (value.size() >= 2 &&
        ((value.front() == '"' && value.back() == '"') ||
         (value.front() == '\'' && value.back() == '\''))) {
      value = value.substr(1, value.size() - 2);
    }
    if (key == "MINEO_ID") credentials.id = Utf8ToWide(value);
    if (key == "MINEO_PASSWORD") credentials.password = Utf8ToWide(value);
  }
}

MineoCredentials LoadMineoCredentials(const fs::path& dataDir) {
  MineoCredentials credentials;
  ApplyDotEnvFile(dataDir.parent_path() / L".env", credentials);
  ApplyDotEnvFile(dataDir / L".env", credentials);
  return credentials;
}

std::wstring JsString(const std::wstring& value) {
  return winrt::Windows::Data::Json::JsonValue::CreateStringValue(value)
      .Stringify().c_str();
}

int DateKey(const SYSTEMTIME& value) {
  return static_cast<int>(value.wYear) * 10000 +
      static_cast<int>(value.wMonth) * 100 + value.wDay;
}

bool InScheduleWindow(const SYSTEMTIME& value, int hour, int minute) {
  const int current = static_cast<int>(value.wHour) * 60 + value.wMinute;
  const int start = std::clamp(hour, 0, 23) * 60 + std::clamp(minute, 0, 59);
  const int end = (start + kScheduleWindowMinutes) % (24 * 60);
  return end > start ? current >= start && current < end
                     : current >= start || current < end;
}

std::wstring HResultHex(HRESULT value) {
  std::wostringstream output;
  output << L"0x" << std::hex << static_cast<unsigned long>(value);
  return output.str();
}

class MineoAutomation {
 public:
  MineoAutomation(HWND ownerWindow, fs::path sharedDataFolder, Logger& log)
      : ownerWindow_(ownerWindow), sharedDataFolder_(std::move(sharedDataFolder)),
        dataDir_(sharedDataFolder_.parent_path()), statePath_(dataDir_ / L"mineo-automation.json"),
        log_(log) {
    AppConfig appConfig = LoadConfig(dataDir_ / L"settings.json");
    ApplyCloudConfig(appConfig, dataDir_ / L"device-config.json");
    config_ = appConfig.mineo;
    credentials_ = LoadMineoCredentials(dataDir_);
    config_.morningHour = 6;
    config_.morningMinute = 58;
    config_.nightHour = 22;
    config_.nightMinute = 58;
    LoadState();
    if (credentials_.id.empty() || credentials_.password.empty()) {
      log_.Warn(L"mineo auto-login credentials are incomplete; set MINEO_ID and MINEO_PASSWORD in data\\.env");
    } else {
      log_.Info(L"mineo auto-login credentials loaded");
    }
  }

  ~MineoAutomation() { Stop(); }

  void Tick(int64_t nowMs) {
    if (!config_.enabled || stopping_) return;
    SYSTEMTIME local{};
    GetLocalTime(&local);
    const int today = DateKey(local);
    const bool morningDue = InScheduleWindow(local, config_.morningHour, config_.morningMinute) && state_.morningDate != today;
    const bool nightDataDue = InScheduleWindow(local, config_.nightHour, config_.nightMinute) && state_.nightDate != today;
    const bool nightYuzuDue = InScheduleWindow(local, config_.nightHour, config_.nightMinute) && config_.yuzuEnabled && state_.yuzuDate != today;
    if (!scheduledActive_ && (morningDue || nightDataDue || nightYuzuDue)) {
      scheduledActive_ = true;
      scheduledDate_ = today;
      scheduledMorning_ = morningDue;
      dataSatisfied_ = scheduledMorning_ ? state_.morningDate == today : state_.nightDate == today;
      yuzuSatisfied_ = !config_.yuzuEnabled || state_.yuzuDate == today;
      activeUntil_ = nowMs + 60 * 60'000;
      nextProbeAt_ = 0;
      EnsureStarted();
      log_.Info(scheduledMorning_ ? L"mineo 06:58 background automation started" : L"mineo 22:58 background automation started");
    }
    if (scheduledActive_ && nowMs >= activeUntil_) {
      log_.Warn(L"mineo automation window expired before completion");
      scheduledActive_ = false;
      loginRequired_ = false;
      HideWindow();
    }
    if (!scheduledActive_ || !webview_ || navigating_ || probePending_ || nowMs < nextProbeAt_) return;
    ExecuteProbe();
  }

  void Stop() noexcept {
    if (stopping_.exchange(true)) return;
    callbackAlive_->store(false, std::memory_order_release);
    if (webview_) {
      if (navigationToken_.value) webview_->remove_NavigationCompleted(navigationToken_);
      if (newWindowToken_.value) webview_->remove_NewWindowRequested(newWindowToken_);
      if (processFailedToken_.value) webview_->remove_ProcessFailed(processFailedToken_);
    }
    if (controller_) controller_->Close();
    webview_.Reset();
    controller_.Reset();
    environment_.Reset();
    if (window_ && IsWindow(window_)) DestroyWindow(window_);
    window_ = nullptr;
  }

 private:
  struct State {
    int morningDate = 0;
    int nightDate = 0;
    int yuzuDate = 0;
    bool setupShown = false;
  };

  static LRESULT CALLBACK WindowProc(HWND window, UINT message, WPARAM wParam, LPARAM lParam) {
    MineoAutomation* self = reinterpret_cast<MineoAutomation*>(GetWindowLongPtrW(window, GWLP_USERDATA));
    if (message == WM_NCCREATE) {
      self = static_cast<MineoAutomation*>(reinterpret_cast<CREATESTRUCTW*>(lParam)->lpCreateParams);
      SetWindowLongPtrW(window, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(self));
    }
    if (!self) return DefWindowProcW(window, message, wParam, lParam);
    if (message == WM_CLOSE) {
      self->HideWindow();
      return 0;
    }
    if (message == WM_SIZE) {
      self->LayoutController();
      return 0;
    }
    return DefWindowProcW(window, message, wParam, lParam);
  }
