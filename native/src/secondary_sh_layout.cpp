// Part of secondary_sh.cpp's translation unit (see the #include at the end of
// that file). Window/host management for the secondary Stationhead player:
// host-window creation and the interactive/behind-dashboard/1x1 placement.
#include "secondary_sh.h"

namespace hp {

bool SecondaryStationheadPlayer::EnsureHostWindow() {
  if (hostWindow_ && IsWindow(hostWindow_)) return true;
  if (!window_ || !IsWindow(window_)) return false;
  static constexpr wchar_t kClassName[] = L"HomePanelSecondaryStationheadHost";
  static std::once_flag classOnce;
  std::call_once(classOnce, [] {
    WNDCLASSW windowClass{};
    windowClass.lpfnWndProc = DefWindowProcW;
    windowClass.hInstance = GetModuleHandleW(nullptr);
    windowClass.lpszClassName = kClassName;
    windowClass.hCursor = LoadCursorW(nullptr, IDC_ARROW);
    RegisterClassW(&windowClass);
  });
  const int width = std::max(1L, bounds_.right - bounds_.left);
  const int height = std::max(1L, bounds_.bottom - bounds_.top);
  hostWindow_ = CreateWindowExW(0, kClassName, L"SecondaryStationheadHost",
      WS_CHILD | WS_CLIPCHILDREN | WS_CLIPSIBLINGS, bounds_.left, bounds_.top,
      width, height, window_, nullptr, GetModuleHandleW(nullptr), nullptr);
  return hostWindow_ && IsWindow(hostWindow_);
}

bool SecondaryStationheadPlayer::EnsureAuthHostWindow() {
  if (authHostWindow_ && IsWindow(authHostWindow_)) return true;
  if (!window_ || !IsWindow(window_)) return false;
  static constexpr wchar_t kClassName[] = L"HomePanelSecondarySpotifyAuthHost";
  static std::once_flag classOnce;
  std::call_once(classOnce, [] {
    WNDCLASSW windowClass{};
    windowClass.lpfnWndProc = DefWindowProcW;
    windowClass.hInstance = GetModuleHandleW(nullptr);
    windowClass.lpszClassName = kClassName;
    windowClass.hCursor = LoadCursorW(nullptr, IDC_ARROW);
    RegisterClassW(&windowClass);
  });
  const int width = std::max(1L, bounds_.right - bounds_.left);
  const int height = std::max(1L, bounds_.bottom - bounds_.top);
  authHostWindow_ = CreateWindowExW(0, kClassName, L"SecondarySpotifyAuthHost",
      WS_CHILD | WS_CLIPCHILDREN | WS_CLIPSIBLINGS, bounds_.left, bounds_.top,
      width, height, window_, nullptr, GetModuleHandleW(nullptr), nullptr);
  return authHostWindow_ && IsWindow(authHostWindow_);
}

void SecondaryStationheadPlayer::SetBounds(const RECT& bounds) {
  if (EqualRect(&bounds_, &bounds)) return;
  bounds_ = bounds;
  LayoutWindows(interactive_ || spotifyAuthorization_ || loginRequired_.load(std::memory_order_relaxed));
}

void SecondaryStationheadPlayer::LayoutWindows(bool interactive) {
  const bool wasInteractive = interactive_;
  const bool authWasVisible = authHostWindow_ && IsWindow(authHostWindow_) && IsWindowVisible(authHostWindow_);
  const int width = std::max(1L, bounds_.right - bounds_.left);
  const int height = std::max(1L, bounds_.bottom - bounds_.top);
  // Background (non-interactive) players collapse to 1x1 so the GPU stops
  // compositing a full-size hidden WebView and the child window can't paint
  // over the dashboard. Audio is size-independent; interactive/auth keep full.
  const int hostWidth = interactive ? width : 1;
  const int hostHeight = interactive ? height : 1;
  const RECT controllerBounds{0, 0, hostWidth, hostHeight};
  const bool showAuth = interactive && spotifyAuthorization_ && authController_;
  if (controller_) {
    controller_->put_Bounds(controllerBounds);
    controller_->put_IsVisible(showAuth ? FALSE : TRUE);
  }
  if (hostWindow_ && IsWindow(hostWindow_)) {
    if (showAuth) {
      ShowWindow(hostWindow_, SW_HIDE);
    } else {
      ShowWindow(hostWindow_, SW_SHOWNOACTIVATE);
      // Stationhead content always stays behind the dashboard WebView so it
      // never covers it; auto-play works while occluded (layout + CDP input).
      SetWindowPos(hostWindow_, HWND_BOTTOM,
                   bounds_.left, bounds_.top, hostWidth, hostHeight,
                   SWP_NOACTIVATE | SWP_SHOWWINDOW);
    }
  }
  if (authController_) {
    authController_->put_Bounds(controllerBounds);
    authController_->put_IsVisible(showAuth ? TRUE : FALSE);
  }
  if (authHostWindow_ && IsWindow(authHostWindow_)) {
    if (showAuth) {
      ShowWindow(authHostWindow_, SW_SHOWNOACTIVATE);
      SetWindowPos(authHostWindow_, HWND_TOP, bounds_.left, bounds_.top, width, height,
                   SWP_NOACTIVATE | SWP_SHOWWINDOW);
    } else {
      ShowWindow(authHostWindow_, SW_HIDE);
    }
  }
  interactive_ = interactive;
  {
    std::lock_guard lock(mutex_);
    status_.visible = interactive;
    status_.spotifyAuthorization = spotifyAuthorization_;
    status_.apiAuthorization = apiAuthorization_;
  }
  if (interactive && (!wasInteractive || (showAuth && !authWasVisible))) {
    HWND target = showAuth ? authHostWindow_ : hostWindow_;
    if (target && IsWindow(target)) SetFocus(target);
    if (showAuth && authController_) authController_->MoveFocus(COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC);
    else if (controller_) controller_->MoveFocus(COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC);
  }
}

void SecondaryStationheadPlayer::ShowInteractive(bool interactive) {
  LayoutWindows(interactive || spotifyAuthorization_ || loginRequired_.load(std::memory_order_acquire));
}

void SecondaryStationheadPlayer::SetStartupBounds() {
  ShowInteractive(false);
}

}  // namespace hp
