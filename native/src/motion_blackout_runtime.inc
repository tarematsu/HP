#include "cloud_client.h"
#include <winrt/Windows.Data.Json.h>

namespace hp {
namespace {

constexpr wchar_t kMotionBlackoutClass[] = L"HomePanelMotionBlackout";
constexpr wchar_t kMainWindowClass[] = L"HomePanelNativeWindow";
constexpr int64_t kMotionIdleDelayMs = 60'000;
constexpr int64_t kMotionStartupGraceMs = 60'000;
constexpr int64_t kSwitchBotFreshnessMs = 2 * 60'000;
constexpr int64_t kMotionPollActiveMs = 10'000;
constexpr int64_t kMotionPollIdleMs = 2'000;

class MotionBlackoutController {
 public:
  MotionBlackoutController() {
    instance_ = this;
    wchar_t executable[MAX_PATH * 4]{};
    if (GetModuleFileNameW(nullptr, executable, _countof(executable))) {
      switchbotPath_ = fs::path(executable).parent_path() / L"data" / L"switchbot.json";
    }
    hook_ = SetWindowsHookExW(WH_CALLWNDPROC, HookProc, nullptr, GetCurrentThreadId());
  }

  ~MotionBlackoutController() {
    if (hook_) UnhookWindowsHookEx(hook_);
    if (overlay_ && IsWindow(overlay_)) DestroyWindow(overlay_);
    instance_ = nullptr;
  }

 private:
  static LRESULT CALLBACK HookProc(int code, WPARAM wParam, LPARAM lParam) {
    if (code >= 0 && instance_) {
      const auto* message = reinterpret_cast<const CWPSTRUCT*>(lParam);
      instance_->HandleMessage(*message);
    }
    return CallNextHookEx(instance_ ? instance_->hook_ : nullptr, code, wParam, lParam);
  }

  static LRESULT CALLBACK OverlayProc(HWND window, UINT message, WPARAM wParam, LPARAM lParam) {
    switch (message) {
      case WM_ERASEBKGND:
        return 1;
      case WM_PAINT: {
        PAINTSTRUCT paint{};
        HDC dc = BeginPaint(window, &paint);
        FillRect(dc, &paint.rcPaint, reinterpret_cast<HBRUSH>(GetStockObject(BLACK_BRUSH)));
        EndPaint(window, &paint);
        return 0;
      }
      case WM_SETCURSOR:
        SetCursor(nullptr);
        return TRUE;
      case WM_NCHITTEST:
        return HTCLIENT;
    }
    return DefWindowProcW(window, message, wParam, lParam);
  }

  static bool IsMainWindow(HWND window) {
    wchar_t className[64]{};
    return GetClassNameW(window, className, _countof(className)) > 0 &&
           wcscmp(className, kMainWindowClass) == 0;
  }

  void EnsureAttached(HWND window) {
    if (mainWindow_ || !IsMainWindow(window)) return;
    mainWindow_ = window;
    blackoutAllowedAt_ = UnixMillis() + kMotionStartupGraceMs;

    WNDCLASSW windowClass{};
    windowClass.lpfnWndProc = OverlayProc;
    windowClass.hInstance = GetModuleHandleW(nullptr);
    windowClass.hbrBackground = reinterpret_cast<HBRUSH>(GetStockObject(BLACK_BRUSH));
    windowClass.lpszClassName = kMotionBlackoutClass;
    RegisterClassW(&windowClass);

    overlay_ = CreateWindowExW(
        WS_EX_NOACTIVATE,
        kMotionBlackoutClass,
        L"",
        WS_CHILD | WS_CLIPSIBLINGS,
        0, 0, 1, 1,
        mainWindow_,
        nullptr,
        GetModuleHandleW(nullptr),
        nullptr);
    RefreshState(true);
    Update(UnixMillis());
  }

  void HandleMessage(const CWPSTRUCT& message) {
    if (!mainWindow_) EnsureAttached(message.hwnd);
    if (message.hwnd != mainWindow_) return;

    switch (message.message) {
      case WM_TIMER:
        RefreshState(false);
        Update(UnixMillis());
        break;
      case WM_HP_SWITCHBOT_UPDATED:
        RefreshState(true);
        Update(UnixMillis());
        break;
      case WM_HP_STATIONHEAD_CHANGED:
      case WM_SHOWWINDOW:
      case WM_SIZE:
        if (covered_) LayoutOverlay();
        break;
      case WM_DESTROY:
        if (overlay_ && IsWindow(overlay_)) DestroyWindow(overlay_);
        overlay_ = nullptr;
        mainWindow_ = nullptr;
        covered_ = false;
        blackoutAllowedAt_ = 0;
        break;
    }
  }

  static int64_t Timestamp(const winrt::Windows::Data::Json::JsonObject& object,
                           const wchar_t* name) {
    const double value = object.GetNamedNumber(name, 0);
    return std::isfinite(value) && value > 0 ? static_cast<int64_t>(value) : 0;
  }

  void RefreshState(bool force) {
    if (switchbotPath_.empty()) return;
    std::error_code error;
    const auto modified = fs::last_write_time(switchbotPath_, error);
    if (error) return;
    if (!force && stateLoaded_ && modified == switchbotModified_) return;

    try {
      std::ifstream input(switchbotPath_, std::ios::binary);
      const std::string text((std::istreambuf_iterator<char>(input)), {});
      if (text.empty()) return;
      const auto object = winrt::Windows::Data::Json::JsonObject::Parse(Utf8ToWide(text));
      const bool nextMotion = object.GetNamedBoolean(L"motion", false);
      const int64_t nextObservedAt = Timestamp(object, L"observedAt");
      int64_t nextInactiveSince = Timestamp(object, L"motionInactiveSince");
      const bool nextAvailable = object.GetNamedBoolean(L"serviceAvailable", false) &&
                                 object.GetNamedBoolean(L"motionReliable", false) &&
                                 !object.GetNamedBoolean(L"fallback", false);

      if (nextInactiveSince <= 0) {
        if (nextMotion) {
          localInactiveSince_ = 0;
        } else if (!stateLoaded_ || motion_) {
          localInactiveSince_ = nextObservedAt > 0 ? nextObservedAt : UnixMillis();
        }
        nextInactiveSince = localInactiveSince_;
      } else {
        localInactiveSince_ = nextInactiveSince;
      }

      motion_ = nextMotion;
      observedAt_ = nextObservedAt;
      motionInactiveSince_ = nextInactiveSince;
      serviceAvailable_ = nextAvailable;
      switchbotModified_ = modified;
      stateLoaded_ = true;
    } catch (...) {
      // Keep the last known state; freshness timeout fails open if updates stop.
    }
  }

  void MaybeRefreshCloud(int64_t now, bool fresh) {
    if (!fresh) {
      nextCloudRefreshAt_ = 0;
      return;
    }
    const int64_t interval = motion_ ? kMotionPollActiveMs : kMotionPollIdleMs;
    if (nextCloudRefreshAt_ > now) return;
    if (CloudClient* cloud = CloudClient::Current()) {
      cloud->RefreshNow();
      nextCloudRefreshAt_ = now + interval;
    }
  }

  void Update(int64_t now) {
    const bool fresh = stateLoaded_ && serviceAvailable_ && observedAt_ > 0 &&
        observedAt_ <= now + 60'000 && now - observedAt_ <= kSwitchBotFreshnessMs;
    MaybeRefreshCloud(now, fresh);

    const bool startupGraceElapsed = blackoutAllowedAt_ > 0 && now >= blackoutAllowedAt_;
    const bool shouldCover = startupGraceElapsed && fresh && !motion_ &&
                             motionInactiveSince_ > 0 &&
                             now - motionInactiveSince_ >= kMotionIdleDelayMs;
    SetCovered(shouldCover);
  }

  void LayoutOverlay() {
    if (!overlay_ || !mainWindow_ || !IsWindow(overlay_) || !IsWindow(mainWindow_)) return;
    RECT client{};
    GetClientRect(mainWindow_, &client);
    SetWindowPos(
        overlay_, HWND_TOP,
        0, 0,
        std::max(1L, client.right - client.left),
        std::max(1L, client.bottom - client.top),
        SWP_NOACTIVATE | SWP_SHOWWINDOW);
    InvalidateRect(overlay_, nullptr, FALSE);
  }

  void SetCovered(bool covered) {
    if (covered_ == covered) {
      if (covered_) LayoutOverlay();
      return;
    }
    covered_ = covered;
    if (!overlay_ || !IsWindow(overlay_)) return;
    if (covered_) LayoutOverlay();
    else ShowWindow(overlay_, SW_HIDE);
  }

  static inline MotionBlackoutController* instance_ = nullptr;
  HHOOK hook_{};
  HWND mainWindow_{};
  HWND overlay_{};
  fs::path switchbotPath_;
  fs::file_time_type switchbotModified_{};
  bool stateLoaded_ = false;
  bool serviceAvailable_ = false;
  bool motion_ = false;
  bool covered_ = false;
  int64_t observedAt_ = 0;
  int64_t motionInactiveSince_ = 0;
  int64_t localInactiveSince_ = 0;
  int64_t nextCloudRefreshAt_ = 0;
  int64_t blackoutAllowedAt_ = 0;
};

MotionBlackoutController motionBlackoutController;

}  // namespace
}  // namespace hp
