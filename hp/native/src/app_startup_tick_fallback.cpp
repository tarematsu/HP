#include "app.h"
#include "app_startup_tick_fallback.h"
#include "update_shutdown_protocol.h"

namespace hp {
namespace {

constexpr int64_t kStartupFallbackFirstDelayMs = 60'000;
constexpr int64_t kStartupFallbackRetryMs = 5'000;
constexpr int kStartupFallbackAttempts = 7;
constexpr DWORD kWindowCallbackExceptionCode = 0xe0000002u;

HWND gProtectedWindow = nullptr;
WNDPROC gOriginalWindowProc = nullptr;
App* gProtectedOwner = nullptr;
bool gUserCloseRequested = false;

void LogWindowCallbackFailure() noexcept {
  try {
    if (gProtectedOwner) {
      gProtectedOwner->LogUnhandled(kWindowCallbackExceptionCode, nullptr);
    }
  } catch (...) {
  }
}

LRESULT CALLBACK ProtectedWindowProc(
    HWND window, UINT message, WPARAM wParam, LPARAM lParam) noexcept {
  const WNDPROC original = gOriginalWindowProc;
  if (!original) return DefWindowProcW(window, message, wParam, lParam);

  if (message == WM_SYSCOMMAND && (wParam & 0xfff0u) == SC_CLOSE) {
    gUserCloseRequested = true;
  }
  if (message == kUpdateShutdownMessage) {
    return CallWindowProcW(original, window, WM_CLOSE, 0, 0);
  }
  if (message == WM_CLOSE) {
    if (!gUserCloseRequested) return 0;
    gUserCloseRequested = false;
  }

  try {
    return CallWindowProcW(original, window, message, wParam, lParam);
  } catch (...) {
    LogWindowCallbackFailure();
    if (message == WM_PAINT) ValidateRect(window, nullptr);
    return message == WM_NCCREATE ? FALSE : 0;
  }
}

void InstallWindowProtection(HWND window, App* owner) noexcept {
  if (!window || !owner || gProtectedWindow) return;
  SetLastError(ERROR_SUCCESS);
  const LONG_PTR previous = SetWindowLongPtrW(
      window, GWLP_WNDPROC, reinterpret_cast<LONG_PTR>(ProtectedWindowProc));
  if (!previous && GetLastError() != ERROR_SUCCESS) return;
  gProtectedWindow = window;
  gOriginalWindowProc = reinterpret_cast<WNDPROC>(previous);
  gProtectedOwner = owner;
  gUserCloseRequested = false;
}

void RemoveWindowProtection() noexcept {
  const HWND window = gProtectedWindow;
  const WNDPROC original = gOriginalWindowProc;
  if (window && original && IsWindow(window)) {
    const auto current = reinterpret_cast<WNDPROC>(
        GetWindowLongPtrW(window, GWLP_WNDPROC));
    if (current == ProtectedWindowProc) {
      SetWindowLongPtrW(window, GWLP_WNDPROC, reinterpret_cast<LONG_PTR>(original));
    }
  }
  gProtectedWindow = nullptr;
  gOriginalWindowProc = nullptr;
  gProtectedOwner = nullptr;
  gUserCloseRequested = false;
}

class StartupUpdateFallback final {
 public:
  ~StartupUpdateFallback() { Stop(); }

  void Start(HWND window, App* owner) noexcept {
    Stop();
    if (!window || !owner) return;
    InstallWindowProtection(window, owner);

    {
      std::lock_guard lock(mutex_);
      stopping_ = false;
      completed_ = false;
    }
    try {
      worker_ = std::thread([this, window, owner] { Run(window, owner); });
    } catch (...) {
      std::lock_guard lock(mutex_);
      stopping_ = true;
    }
  }

  void Complete() noexcept {
    {
      std::lock_guard lock(mutex_);
      completed_ = true;
    }
    wake_.notify_all();
  }

  void Stop() noexcept {
    {
      std::lock_guard lock(mutex_);
      stopping_ = true;
      completed_ = true;
    }
    wake_.notify_all();
    if (worker_.joinable()) worker_.join();
    RemoveWindowProtection();
  }

 private:
  [[nodiscard]] bool WaitFor(int64_t milliseconds) noexcept {
    std::unique_lock lock(mutex_);
    return wake_.wait_for(
        lock,
        std::chrono::milliseconds(milliseconds),
        [this] { return stopping_ || completed_; });
  }

  [[nodiscard]] static bool WindowStillOwnedBy(
      HWND window, const App* owner) noexcept {
    if (!window || !IsWindow(window)) return false;
    DWORD processId = 0;
    GetWindowThreadProcessId(window, &processId);
    if (processId != GetCurrentProcessId()) return false;
    return reinterpret_cast<App*>(
               GetWindowLongPtrW(window, GWLP_USERDATA)) == owner;
  }

  void Run(HWND window, App* owner) noexcept {
    if (WaitFor(kStartupFallbackFirstDelayMs)) return;
    for (int attempt = 0; attempt < kStartupFallbackAttempts; ++attempt) {
      if (!WindowStillOwnedBy(window, owner)) return;

      // This is an ordinary posted application message rather than a synthesized
      // low-priority WM_TIMER. A foreground WebView2 therefore cannot postpone
      // the startup update decision by continuously keeping the UI queue busy.
      if (!PostMessageW(window, kStartupUpdateWakeMessage, 0, 0)) return;

      if (attempt + 1 < kStartupFallbackAttempts &&
          WaitFor(kStartupFallbackRetryMs)) {
        return;
      }
    }
  }

  std::mutex mutex_;
  std::condition_variable wake_;
  bool stopping_ = true;
  bool completed_ = true;
  std::thread worker_;
};

StartupUpdateFallback& StartupFallbackState() {
  static StartupUpdateFallback state;
  return state;
}

static_assert(kStartupFallbackFirstDelayMs == 60'000);
static_assert(kStartupFallbackRetryMs == 5'000);
static_assert(kStartupFallbackAttempts >= 2);

}  // namespace

void StartStartupUpdateFallback(HWND window, App* owner) noexcept {
  StartupFallbackState().Start(window, owner);
}

void CompleteStartupUpdateFallback() noexcept {
  StartupFallbackState().Complete();
}

void StopStartupUpdateFallback() noexcept {
  StartupFallbackState().Stop();
}

void App::HandleStartupUpdateWake() {
  if (!startupUpdateScheduled_ && renderer_ && sensors_ && stationhead_ && cloud_) {
    StartDeferredServices(UnixMillis(), renderState_.stationhead);
  }
  if (startupUpdateScheduled_) CompleteStartupUpdateFallback();
}

}  // namespace hp
