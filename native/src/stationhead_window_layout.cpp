#include "sh.h"
#include "secondary_sh.h"
#include <set>

namespace hp {
namespace {

HWND CreateStationheadChildHost(HWND parent, const wchar_t* className, const wchar_t* title,
                                const RECT& bounds) {
  if (!parent || !IsWindow(parent)) return nullptr;
  static std::mutex classMutex;
  static std::set<std::wstring> registeredClasses;
  {
    std::lock_guard lock(classMutex);
    if (!registeredClasses.contains(className)) {
      WNDCLASSW windowClass{};
      windowClass.lpfnWndProc = DefWindowProcW;
      windowClass.hInstance = GetModuleHandleW(nullptr);
      windowClass.lpszClassName = className;
      windowClass.hCursor = LoadCursorW(nullptr, IDC_ARROW);
      RegisterClassW(&windowClass);
      registeredClasses.insert(className);
    }
  }

  const int width = std::max(1L, bounds.right - bounds.left);
  const int height = std::max(1L, bounds.bottom - bounds.top);
  return CreateWindowExW(0, className, title, WS_CHILD | WS_CLIPCHILDREN | WS_CLIPSIBLINGS,
                         bounds.left, bounds.top, width, height, parent, nullptr,
                         GetModuleHandleW(nullptr), nullptr);
}

void ApplyStationheadChildLayout(HWND hostWindow,
                                 HWND authHostWindow,
                                 ICoreWebView2Controller* controller,
                                 ICoreWebView2Controller* authController,
                                 const RECT& bounds,
                                 bool contentVisible,
                                 bool showAuth,
                                 bool previewVisible,
                                 bool backgroundNeedsGeometry) {
  const int width = std::max(1L, bounds.right - bounds.left);
  const int height = std::max(1L, bounds.bottom - bounds.top);
  // On-screen states (startup preview, interactive login/content) show the host
  // on the visible desktop. Background states (normal playback and the auto-play
  // startup scan) are parked below the parent client area so the host never
  // paints over the dashboard. While the scan is still running the surface must
  // keep its full pixel size, because auto-play detection relies on
  // getBoundingClientRect()/elementFromPoint geometry that collapses at 1x1 (the
  // scan can no longer see or click "Start Listening", so audio never starts).
  // Once playback is confirmed (backgroundNeedsGeometry == false) it collapses
  // to 1x1 so the GPU stops compositing a full-size hidden WebView.
  const bool onScreen = previewVisible || contentVisible;
  const bool fullSize = onScreen || backgroundNeedsGeometry;
  const int hostWidth = fullSize ? width : 1;
  const int hostHeight = fullSize ? height : 1;
  const RECT contentBounds{0, 0, hostWidth, hostHeight};
  const RECT authBounds{0, 0, width, height};

  if (controller) {
    controller->put_ZoomFactor(1.0);
    controller->put_Bounds(contentBounds);
    controller->put_IsVisible(showAuth ? FALSE : TRUE);
  }

  if (hostWindow && IsWindow(hostWindow)) {
    if (showAuth) {
      ShowWindow(hostWindow, SW_HIDE);
    } else {
      int posX = bounds.left;
      int posY = bounds.top;
      if (!onScreen) {
        // hostWindow is a WS_CHILD, so coordinates are relative to the parent
        // client area. Pushing the top a full virtual-screen height below the
        // workspace bottom moves the surface entirely outside the parent's
        // visible client (clipped away) so it never covers the dashboard.
        posY = bounds.bottom + GetSystemMetrics(SM_CYVIRTUALSCREEN) + 8;
      }
      SetWindowRgn(hostWindow, nullptr, FALSE);
      ShowWindow(hostWindow, SW_SHOWNOACTIVATE);
      SetWindowPos(hostWindow, previewVisible ? HWND_TOP : HWND_BOTTOM,
                   posX, posY, hostWidth, hostHeight,
                   SWP_NOACTIVATE | SWP_SHOWWINDOW);
    }
  }

  if (authController) {
    authController->put_Bounds(authBounds);
    authController->put_IsVisible(showAuth ? TRUE : FALSE);
  }

  if (authHostWindow && IsWindow(authHostWindow)) {
    if (showAuth) {
      ShowWindow(authHostWindow, SW_SHOWNOACTIVATE);
      SetWindowPos(authHostWindow, HWND_TOP, bounds.left, bounds.top, width, height,
                   SWP_NOACTIVATE | SWP_SHOWWINDOW);
    } else {
      ShowWindow(authHostWindow, SW_HIDE);
    }
  }
}

void FocusStationheadSurface(bool allowFocus,
                             bool showAuth,
                             HWND hostWindow,
                             HWND authHostWindow,
                             ICoreWebView2Controller* controller,
                             ICoreWebView2Controller* authController) {
  if (!allowFocus) return;
  HWND target = showAuth ? authHostWindow : hostWindow;
  if (target && IsWindow(target)) SetFocus(target);
  if (showAuth && authController) authController->MoveFocus(COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC);
  else if (controller) controller->MoveFocus(COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC);
}

}  // namespace

bool StationheadPlayer::EnsureHostWindow() {
  if (hostWindow_ && IsWindow(hostWindow_)) return true;
  hostWindow_ = CreateStationheadChildHost(window_, L"HomePanelStationheadHost",
                                           L"StationheadHost", bounds_);
  return hostWindow_ && IsWindow(hostWindow_);
}

bool StationheadPlayer::EnsureAuthHostWindow() {
  if (authHostWindow_ && IsWindow(authHostWindow_)) return true;
  authHostWindow_ = CreateStationheadChildHost(window_, L"HomePanelSpotifyAuthHost",
                                               L"SpotifyAuthHost", bounds_);
  controllerLayoutValid_ = false;
  return authHostWindow_ && IsWindow(authHostWindow_);
}

void StationheadPlayer::LayoutHostWindow(bool background) {
  if (!EnsureHostWindow()) return;
  if (background) KeepPlaybackBehindDashboard();
  else {
    LayoutControllers();
    viewVisible_ = true;
    std::lock_guard lock(mutex_);
    status_.visible = true;
  }
}

void StationheadPlayer::KeepPlaybackBehindDashboard() {
  if (!EnsureHostWindow()) {
    viewVisible_ = false;
    std::lock_guard lock(mutex_);
    status_.visible = false;
    return;
  }
  startupPreviewActive_ = false;
  viewVisible_ = false;
  selectedTab_ = StationheadTabKind::None;
  ApplyStationheadChildLayout(hostWindow_, authHostWindow_, controller_.Get(), authController_.Get(),
                              bounds_, false, false, false,
                              !audioPlaying_.load(std::memory_order_relaxed));
  backgroundHostPlaced_ = true;
  controllerLayoutValid_ = false;
  std::lock_guard lock(mutex_);
  status_.visible = false;
}

void StationheadPlayer::SetStartupBounds() {
  selectedTab_ = StationheadTabKind::None;
  viewVisible_ = false;
  controllerLayoutValid_ = false;
  LayoutControllers();
}

void StationheadPlayer::SetStartupPreviewBounds(const RECT& bounds) {
  startupPreviewActive_ = true;
  bounds_ = bounds;
  controllerLayoutValid_ = false;
  LayoutControllers();
}

void StationheadPlayer::ClearStartupPreviewBounds() {
  if (!startupPreviewActive_) return;
  startupPreviewActive_ = false;
  controllerLayoutValid_ = false;
  SetStartupBounds();
}

void StationheadPlayer::SetVisible(bool visible) {
  if (!visible) {
    selectedTab_ = StationheadTabKind::None;
    if (controller_) KeepPlaybackBehindDashboard();
    else {
      startupPreviewActive_ = false;
      viewVisible_ = false;
      std::lock_guard lock(mutex_);
      status_.visible = false;
    }
    if (window_ && IsWindow(window_)) SetFocus(window_);
    return;
  }
  startupPreviewActive_ = false;
  if (selectedTab_ == StationheadTabKind::None && !NeedsInteractiveWindow()) {
    selectedTab_ = StationheadTabKind::Stationhead;
  }
  if (!controller_) {
    viewVisible_ = selectedTab_ != StationheadTabKind::None || NeedsInteractiveWindow();
    std::lock_guard lock(mutex_);
    status_.visible = viewVisible_;
    return;
  }
  if (selectedTab_ == StationheadTabKind::None && !NeedsInteractiveWindow()) {
    KeepPlaybackBehindDashboard();
    return;
  }
  const bool wasVisible = viewVisible_;
  viewVisible_ = true;
  LayoutControllers();
  ApplyMute();
  if (!wasVisible && controller_) controller_->MoveFocus(COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC);
}

void StationheadPlayer::LayoutControllers() {
  if (!EnsureHostWindow()) return;
  const bool preview = startupPreviewActive_;
  const bool showAuth = !preview && selectedTab_ == StationheadTabKind::Auth && authController_;
  ApplyStationheadChildLayout(hostWindow_, authHostWindow_, controller_.Get(), authController_.Get(),
                              bounds_, viewVisible_, showAuth, preview,
                              !audioPlaying_.load(std::memory_order_relaxed));
  backgroundHostPlaced_ = !(preview || viewVisible_);
  controllerLayoutValid_ = true;
  lastControllerLayoutBounds_ = bounds_;
  lastControllerLayoutTab_ = selectedTab_;
  lastLayoutHadAuthController_ = authController_ != nullptr;
  std::lock_guard lock(mutex_);
  status_.visible = preview || viewVisible_;
}

bool SecondaryStationheadPlayer::EnsureHostWindow() {
  if (hostWindow_ && IsWindow(hostWindow_)) return true;
  hostWindow_ = CreateStationheadChildHost(window_, L"HomePanelSecondaryStationheadHost",
                                           L"SecondaryStationheadHost", bounds_);
  return hostWindow_ && IsWindow(hostWindow_);
}

bool SecondaryStationheadPlayer::EnsureAuthHostWindow() {
  if (authHostWindow_ && IsWindow(authHostWindow_)) return true;
  authHostWindow_ = CreateStationheadChildHost(window_, L"HomePanelSecondarySpotifyAuthHost",
                                               L"SecondarySpotifyAuthHost", bounds_);
  return authHostWindow_ && IsWindow(authHostWindow_);
}

void SecondaryStationheadPlayer::SetBounds(const RECT& bounds) {
  if (EqualRect(&bounds_, &bounds)) return;
  bounds_ = bounds;
  LayoutWindows(interactive_ || spotifyAuthorization_ || loginRequired_.load(std::memory_order_relaxed));
}

void SecondaryStationheadPlayer::SetStartupPreviewBounds(const RECT& bounds) {
  startupPreviewActive_ = true;
  bounds_ = bounds;
  LayoutWindows(interactive_ || spotifyAuthorization_ || loginRequired_.load(std::memory_order_relaxed));
}

void SecondaryStationheadPlayer::ClearStartupPreviewBounds() {
  if (!startupPreviewActive_) return;
  startupPreviewActive_ = false;
  LayoutWindows(interactive_ || spotifyAuthorization_ || loginRequired_.load(std::memory_order_relaxed));
}

void SecondaryStationheadPlayer::LayoutWindows(bool interactive) {
  const bool wasInteractive = interactive_;
  const bool authWasVisible = authHostWindow_ && IsWindow(authHostWindow_) && IsWindowVisible(authHostWindow_);
  const bool preview = startupPreviewActive_;
  const bool showAuth = !preview && interactive && spotifyAuthorization_ && authController_;
  EnsureHostWindow();
  ApplyStationheadChildLayout(hostWindow_, authHostWindow_, controller_.Get(), authController_.Get(),
                              bounds_, interactive, showAuth, preview,
                              !audioPlaying_.load(std::memory_order_relaxed));
  interactive_ = interactive;
  {
    std::lock_guard lock(mutex_);
    status_.visible = preview || interactive;
    status_.spotifyAuthorization = spotifyAuthorization_;
    status_.apiAuthorization = apiAuthorization_;
  }
  FocusStationheadSurface(!preview && interactive && (!wasInteractive || (showAuth && !authWasVisible)),
                          showAuth, hostWindow_, authHostWindow_, controller_.Get(), authController_.Get());
}

void SecondaryStationheadPlayer::ShowInteractive(bool interactive) {
  startupPreviewActive_ = false;
  LayoutWindows(interactive || spotifyAuthorization_ || loginRequired_.load(std::memory_order_acquire));
}

void SecondaryStationheadPlayer::SetStartupBounds() {
  LayoutWindows(false);
}

}  // namespace hp
