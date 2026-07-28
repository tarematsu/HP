#include "app.h"
#include "app_startup_tick_fallback.h"

namespace hp {
namespace {

constexpr int64_t kStartupFallbackFirstDelayMs = 60'000;
constexpr int64_t kStartupFallbackRetryMs = 5'000;
constexpr int kStartupFallbackAttempts = 7;

class StartupUpdateFallback final {
 public:
  ~StartupUpdateFallback() { Stop(); }

  void Start(HWND window, App* owner) noexcept {
    Stop();
    if (!window || !owner) return;

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
