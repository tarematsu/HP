#include "sh.h"
#include "stationhead_monitor_probe.h"

namespace hp {
namespace {

int RectWidth(const RECT& bounds) noexcept {
  return std::max(1L, bounds.right - bounds.left);
}

int RectHeight(const RECT& bounds) noexcept {
  return std::max(1L, bounds.bottom - bounds.top);
}

HWND CreateStationheadChildHost(HWND parent, const wchar_t* className, const wchar_t* title,
                                const RECT& bounds) {
  if (!parent || !IsWindow(parent)) return nullptr;
  const HINSTANCE instance = GetModuleHandleW(nullptr);
  WNDCLASSW registered{};
  if (!GetClassInfoW(instance, className, &registered)) {
    WNDCLASSW windowClass{};
    windowClass.lpfnWndProc = DefWindowProcW;
    windowClass.hInstance = instance;
    windowClass.lpszClassName = className;
    windowClass.hCursor = LoadCursorW(nullptr, IDC_ARROW);
    if (!RegisterClassW(&windowClass) && GetLastError() != ERROR_CLASS_ALREADY_EXISTS) {
      return nullptr;
    }
  }

  const RECT background = StationheadBackgroundBounds(bounds);
  return CreateWindowExW(0, className, title,
                         WS_CHILD | WS_CLIPCHILDREN | WS_CLIPSIBLINGS,
                         background.left, background.top,
                         RectWidth(background), RectHeight(background),
                         parent, nullptr, instance, nullptr);
}

bool WindowClientSizeMatches(HWND window, int width, int height) noexcept {
  RECT client{};
  return window && GetClientRect(window, &client) &&
         client.right - client.left == width &&
         client.bottom - client.top == height;
}

bool WindowContainsFocus(HWND window) noexcept {
  const HWND focused = GetFocus();
  return window && IsWindow(window) && focused &&
         (focused == window || IsChild(window, focused));
}

bool ChildWindowPlacementMatches(HWND window, const RECT& expected,
                                 HWND placement) noexcept {
  if (!window) return false;
  HWND parent = GetParent(window);
  RECT current{};
  if (!parent || !GetWindowRect(window, &current)) return false;
  POINT topLeft{current.left, current.top};
  POINT bottomRight{current.right, current.bottom};
  if (!ScreenToClient(parent, &topLeft) ||
      !ScreenToClient(parent, &bottomRight)) {
    return false;
  }
  const RECT parentRelative{topLeft.x, topLeft.y, bottomRight.x, bottomRight.y};
  if (!EqualRect(&parentRelative, &expected)) return false;
  if (placement == HWND_TOP) return GetWindow(window, GW_HWNDPREV) == nullptr;
  if (placement == HWND_BOTTOM) return GetWindow(window, GW_HWNDNEXT) == nullptr;
  return true;
}

bool ControllerBoundsMatch(ICoreWebView2Controller* controller,
                           const RECT& expected) noexcept {
  RECT current{};
  return controller && SUCCEEDED(controller->get_Bounds(&current)) &&
         EqualRect(&current, &expected);
}

bool ControllerVisibilityMatches(ICoreWebView2Controller* controller,
                                 BOOL expected) noexcept {
  BOOL current = FALSE;
  return controller && SUCCEEDED(controller->get_IsVisible(&current)) &&
         current == expected;
}

bool SurfaceMatches(HWND hostWindow,
                    ICoreWebView2Controller* controller,
                    const RECT& expectedHostBounds,
                    HWND placement) noexcept {
  if (!hostWindow || !IsWindow(hostWindow) || !IsWindowVisible(hostWindow)) {
    return false;
  }
  const int width = RectWidth(expectedHostBounds);
  const int height = RectHeight(expectedHostBounds);
  const RECT controllerBounds{0, 0, width, height};
  return WindowClientSizeMatches(hostWindow, width, height) &&
         ChildWindowPlacementMatches(hostWindow, expectedHostBounds, placement) &&
         ControllerBoundsMatch(controller, controllerBounds) &&
         ControllerVisibilityMatches(controller, TRUE);
}

bool BackgroundAuthSurfaceMatches(HWND authHostWindow,
                                  ICoreWebView2Controller* authController,
                                  const RECT& workspaceBounds) noexcept {
  if (!authHostWindow || !IsWindow(authHostWindow)) return authController == nullptr;
  const RECT background = StationheadBackgroundBounds(workspaceBounds);
  if (!authController) {
    return IsWindowVisible(authHostWindow) &&
           WindowClientSizeMatches(authHostWindow,
                                   RectWidth(background),
                                   RectHeight(background)) &&
           ChildWindowPlacementMatches(authHostWindow, background, nullptr);
  }
  return SurfaceMatches(authHostWindow, authController, background, nullptr);
}

bool ActiveAuthSurfaceMatches(HWND hostWindow,
                              HWND authHostWindow,
                              ICoreWebView2Controller* controller,
                              ICoreWebView2Controller* authController,
                              const RECT& workspaceBounds) noexcept {
  if (!authHostWindow || !IsWindow(authHostWindow) ||
      !IsWindowVisible(authHostWindow)) {
    return false;
  }
  const RECT surface = StationheadBackgroundBounds(workspaceBounds);
  return SurfaceMatches(hostWindow, controller, surface, HWND_BOTTOM) &&
         SurfaceMatches(authHostWindow, authController, surface, HWND_TOP);
}

RECT ResolveStationheadWorkspaceBounds(HWND parent,
                                       const RECT& requested) noexcept {
  if (!parent || !IsWindow(parent)) return requested;
  RECT client{};
  if (!GetClientRect(parent, &client) ||
      client.right <= client.left || client.bottom <= client.top) {
    return requested;
  }
  return client;
}

struct StationheadSurfacePolicy {
  bool showAuth = false;
  bool showPlayback = false;
  bool hidePlayback = false;
};

constexpr StationheadSurfacePolicy ResolveStationheadSurfacePolicy(
    StationheadTabKind selectedTab, bool authSurfaceReady,
    bool loginRequired) noexcept {
  const bool authSelected = selectedTab == StationheadTabKind::Auth;
  const bool playbackSelected =
      selectedTab == StationheadTabKind::Stationhead && loginRequired;
  return {authSelected && authSurfaceReady, playbackSelected, authSelected};
}

static_assert(!ResolveStationheadSurfacePolicy(StationheadTabKind::None, false, false).showAuth);
static_assert(!ResolveStationheadSurfacePolicy(StationheadTabKind::None, false, false).showPlayback);
static_assert(!ResolveStationheadSurfacePolicy(StationheadTabKind::None, false, false).hidePlayback);
static_assert(ResolveStationheadSurfacePolicy(StationheadTabKind::Auth, true, false).showAuth);
static_assert(!ResolveStationheadSurfacePolicy(StationheadTabKind::Auth, true, false).showPlayback);
static_assert(ResolveStationheadSurfacePolicy(StationheadTabKind::Auth, true, false).hidePlayback);
static_assert(!ResolveStationheadSurfacePolicy(StationheadTabKind::Auth, false, false).showAuth);
static_assert(ResolveStationheadSurfacePolicy(StationheadTabKind::Auth, false, false).hidePlayback);
static_assert(!ResolveStationheadSurfacePolicy(StationheadTabKind::Stationhead, true, false).showPlayback);
static_assert(ResolveStationheadSurfacePolicy(StationheadTabKind::Stationhead, true, true).showPlayback);
static_assert(!ResolveStationheadSurfacePolicy(StationheadTabKind::Stationhead, true, true).hidePlayback);

void ApplyStationheadChildLayout(HWND hostWindow,
                                 HWND authHostWindow,
                                 ICoreWebView2Controller* controller,
                                 ICoreWebView2Controller* authController,
                                 const RECT& workspaceBounds,
                                 bool showAuth,
                                 bool showPlayback,
                                 bool hidePlayback) {
  const bool monitorForeground = StationheadMonitorForeground();
  const bool playbackForeground =
      showPlayback || (!showAuth && !hidePlayback && monitorForeground);

  const RECT surfaceBounds = StationheadBackgroundBounds(workspaceBounds);
  const RECT playbackHostBounds = surfaceBounds;
  const RECT authHostBounds = surfaceBounds;
  const HWND hostPlacement = playbackForeground ? HWND_TOP : HWND_BOTTOM;
  const HWND authPlacement = showAuth ? HWND_TOP : HWND_BOTTOM;

  const int playbackWidth = RectWidth(playbackHostBounds);
  const int playbackHeight = RectHeight(playbackHostBounds);
  const int authWidth = RectWidth(authHostBounds);
  const int authHeight = RectHeight(authHostBounds);
  const RECT playbackControllerBounds{0, 0, playbackWidth, playbackHeight};
  const RECT authControllerBounds{0, 0, authWidth, authHeight};

  // Move the inactive auth host first, then playback. This keeps the normal
  // playback host at the bottom while both surfaces fill the client area.
  if (authHostWindow && IsWindow(authHostWindow)) {
    const bool geometryMatches =
        WindowClientSizeMatches(authHostWindow, authWidth, authHeight) &&
        ChildWindowPlacementMatches(
            authHostWindow, authHostBounds, showAuth ? HWND_TOP : nullptr);
    if (!geometryMatches || !IsWindowVisible(authHostWindow)) {
      SetWindowPos(authHostWindow, authPlacement,
                   authHostBounds.left, authHostBounds.top,
                   authWidth, authHeight,
                   SWP_NOACTIVATE | SWP_SHOWWINDOW | SWP_NOSENDCHANGING);
    }
  }

  if (hostWindow && IsWindow(hostWindow)) {
    const bool geometryMatches =
        WindowClientSizeMatches(hostWindow, playbackWidth, playbackHeight) &&
        ChildWindowPlacementMatches(
            hostWindow, playbackHostBounds,
            playbackForeground ? HWND_TOP : HWND_BOTTOM);
    if (!geometryMatches || !IsWindowVisible(hostWindow)) {
      SetWindowPos(hostWindow, hostPlacement,
                   playbackHostBounds.left, playbackHostBounds.top,
                   playbackWidth, playbackHeight,
                   SWP_NOACTIVATE | SWP_SHOWWINDOW | SWP_NOSENDCHANGING);
    }
  }

  if (controller) {
    if (!ControllerBoundsMatch(controller, playbackControllerBounds)) {
      controller->put_Bounds(playbackControllerBounds);
    }
    if (!ControllerVisibilityMatches(controller, TRUE)) {
      controller->put_IsVisible(TRUE);
    }
  }

  if (authController) {
    if (!ControllerBoundsMatch(authController, authControllerBounds)) {
      authController->put_Bounds(authControllerBounds);
    }
    if (!ControllerVisibilityMatches(authController, TRUE)) {
      authController->put_IsVisible(TRUE);
    }
  }
}

}  // namespace

bool StationheadPlayer::EnsureHostWindow() {
  if (hostWindow_ && IsWindow(hostWindow_)) return true;
  hostWindow_ = CreateStationheadChildHost(
      window_, L"HomePanelStationheadHost", L"StationheadHost", bounds_);
  return hostWindow_ && IsWindow(hostWindow_);
}

bool StationheadPlayer::EnsureAuthHostWindow() {
  if (authControllerStartedAt_.Active() && !authController_) return false;
  if (authHostWindow_ && IsWindow(authHostWindow_)) return true;
  authHostWindow_ = CreateStationheadChildHost(
      window_, L"HomePanelSpotifyAuthHost", L"SpotifyAuthHost", bounds_);
  return authHostWindow_ && IsWindow(authHostWindow_);
}

void StationheadPlayer::KeepPlaybackBehindDashboard() {
  if (!EnsureHostWindow()) {
    viewVisible_ = false;
    std::lock_guard lock(mutex_);
    status_.visible = false;
    return;
  }

  viewVisible_ = false;
  selectedTab_ = StationheadTabKind::None;
  ApplyStationheadChildLayout(hostWindow_, authHostWindow_, controller_.Get(),
                              authController_.Get(), bounds_,
                              false, false, false);

  std::lock_guard lock(mutex_);
  status_.visible = StationheadMonitorForeground();
}

void StationheadPlayer::SetStartupBounds() {
  selectedTab_ = StationheadTabKind::None;
  viewVisible_ = false;
  LayoutControllers();
}

void StationheadPlayer::SetStartupPreviewBounds(const RECT& bounds) {
  startupPreviewActive_ = true;
  bounds_ = bounds;
  if (selectedTab_ == StationheadTabKind::None) {
    KeepPlaybackBehindDashboard();
    return;
  }
  viewVisible_ = true;
  LayoutControllers();
}

void StationheadPlayer::ClearStartupPreviewBounds() {
  if (!startupPreviewActive_) return;
  const bool preserveInteractiveTab = selectedTab_ != StationheadTabKind::None;
  startupPreviewActive_ = false;
  if (preserveInteractiveTab) {
    viewVisible_ = true;
    LayoutControllers();
    return;
  }
  SetStartupBounds();
}

void StationheadPlayer::SetVisible(bool visible) {
  if (!visible) {
    const bool monitorForeground = StationheadMonitorForeground();
    const RECT expectedPlayback = StationheadBackgroundBounds(bounds_);
    const HWND expectedPlacement = monitorForeground ? HWND_TOP : HWND_BOTTOM;

    if (!viewVisible_ && selectedTab_ == StationheadTabKind::None &&
        SurfaceMatches(hostWindow_, controller_.Get(),
                       expectedPlayback, expectedPlacement) &&
        BackgroundAuthSurfaceMatches(
            authHostWindow_, authController_.Get(), bounds_)) {
      return;
    }

    const bool hadInteractiveSurface =
        viewVisible_ || selectedTab_ != StationheadTabKind::None;
    const bool interactiveSurfaceHadFocus =
        WindowContainsFocus(hostWindow_) || WindowContainsFocus(authHostWindow_);
    selectedTab_ = StationheadTabKind::None;
    if (controller_) {
      KeepPlaybackBehindDashboard();
    } else {
      viewVisible_ = false;
      std::lock_guard lock(mutex_);
      status_.visible = false;
    }

    if (hadInteractiveSurface && interactiveSurfaceHadFocus &&
        window_ && IsWindow(window_) && GetFocus() != window_) {
      SetFocus(window_);
    }
    return;
  }

  if (selectedTab_ != StationheadTabKind::Auth &&
      selectedTab_ != StationheadTabKind::Stationhead) {
    KeepPlaybackBehindDashboard();
    return;
  }

  if (!controller_) {
    viewVisible_ = true;
    std::lock_guard lock(mutex_);
    status_.visible = false;
    return;
  }

  if (selectedTab_ == StationheadTabKind::Auth) {
    if (viewVisible_ && authController_ && authWebview_ &&
        ActiveAuthSurfaceMatches(hostWindow_, authHostWindow_, controller_.Get(),
                                 authController_.Get(), bounds_) &&
        WindowContainsFocus(authHostWindow_)) {
      return;
    }
  } else if (loginRequired_ && viewVisible_ &&
             SurfaceMatches(hostWindow_, controller_.Get(),
                            StationheadBackgroundBounds(bounds_), HWND_TOP) &&
             BackgroundAuthSurfaceMatches(
                 authHostWindow_, authController_.Get(), bounds_) &&
             WindowContainsFocus(hostWindow_)) {
    return;
  }

  viewVisible_ = true;
  LayoutControllers();
  ApplyMute();

  if (selectedTab_ == StationheadTabKind::Auth) {
    if (authController_ && authHostWindow_ &&
        !WindowContainsFocus(authHostWindow_)) {
      authController_->MoveFocus(COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC);
    }
  } else if (loginRequired_ && controller_ && hostWindow_ &&
             !WindowContainsFocus(hostWindow_)) {
    controller_->MoveFocus(COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC);
  }
}

void StationheadPlayer::LayoutControllers() {
  if (!EnsureHostWindow()) {
    std::lock_guard lock(mutex_);
    status_.visible = false;
    return;
  }

  const bool authSurfaceReady = authController_ && authWebview_;
  const StationheadSurfacePolicy policy =
      ResolveStationheadSurfacePolicy(
          selectedTab_, authSurfaceReady, loginRequired_);
  ApplyStationheadChildLayout(hostWindow_, authHostWindow_, controller_.Get(),
                              authController_.Get(), bounds_,
                              policy.showAuth,
                              policy.showPlayback,
                              policy.hidePlayback);

  const bool monitorForeground = StationheadMonitorForeground();
  std::lock_guard lock(mutex_);
  status_.visible = policy.showAuth || policy.showPlayback || monitorForeground;
}

void StationheadPlayer::SetBounds(const RECT& bounds) {
  const RECT resolved = ResolveStationheadWorkspaceBounds(window_, bounds);
  if (!EqualRect(&bounds_, &resolved)) bounds_ = resolved;
  LayoutControllers();
}

void StationheadPlayer::SelectTab(StationheadTabKind tab) {
  if (tab == StationheadTabKind::None && loginRequired_ &&
      !spotifyAuthorization_) {
    tab = StationheadTabKind::Stationhead;
  }
  if (tab == StationheadTabKind::Auth && loginRequired_) {
    loginRequired_ = false;
    std::lock_guard lock(mutex_);
    status_.loginRequired = false;
  }
  if (selectedTab_ == tab) {
    if (tab == StationheadTabKind::None && !viewVisible_) {
      KeepPlaybackBehindDashboard();
      return;
    }
    SetVisible(tab != StationheadTabKind::None);
    return;
  }
  selectedTab_ = tab;
  SetVisible(tab != StationheadTabKind::None);
}

bool StationheadPlayer::HasAuthTab() const {
  return authController_ != nullptr || !authPendingUrl_.empty();
}

HWND StationheadPlayer::ActiveHostWindowForAccountSetup() const noexcept {
  if (selectedTab_ == StationheadTabKind::Auth) {
    if (authController_ && authWebview_ && authHostWindow_ &&
        IsWindow(authHostWindow_)) {
      return authHostWindow_;
    }
    return nullptr;
  }
  if (selectedTab_ == StationheadTabKind::Stationhead && controller_ &&
      hostWindow_ && IsWindow(hostWindow_)) {
    return hostWindow_;
  }
  return nullptr;
}

bool StationheadPlayer::NeedsInteractiveWindow() const {
  return (selectedTab_ == StationheadTabKind::Stationhead && loginRequired_) ||
         selectedTab_ == StationheadTabKind::Auth || spotifyAuthorization_;
}

}  // namespace hp
