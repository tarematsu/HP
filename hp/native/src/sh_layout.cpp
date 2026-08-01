#include "sh.h"

namespace hp {
namespace {

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

  const int width = std::max(1L, bounds.right - bounds.left);
  const int height = std::max(1L, bounds.bottom - bounds.top);
  return CreateWindowExW(0, className, title, WS_CHILD | WS_CLIPCHILDREN | WS_CLIPSIBLINGS,
                           bounds.left, bounds.top, width, height, parent, nullptr,
                           instance, nullptr);
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

bool ChildWindowPlacementMatches(HWND window, const RECT& expected, HWND placement) noexcept {
  if (!window) return false;
  HWND parent = GetParent(window);
  RECT current{};
  if (!parent || !GetWindowRect(window, &current)) return false;
  POINT topLeft{current.left, current.top};
  POINT bottomRight{current.right, current.bottom};
  if (!ScreenToClient(parent, &topLeft) || !ScreenToClient(parent, &bottomRight)) return false;
  const RECT parentRelative{topLeft.x, topLeft.y, bottomRight.x, bottomRight.y};
  if (!EqualRect(&parentRelative, &expected)) return false;
  if (placement == HWND_TOP) return GetWindow(window, GW_HWNDPREV) == nullptr;
  if (placement == HWND_BOTTOM) return GetWindow(window, GW_HWNDNEXT) == nullptr;
  return false;
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

bool PlaybackSurfaceMatches(HWND hostWindow,
                            ICoreWebView2Controller* controller,
                            const RECT& workspaceBounds,
                            int width,
                            int height,
                            HWND placement) noexcept {
  if (!hostWindow || !IsWindow(hostWindow) || !IsWindowVisible(hostWindow)) {
    return false;
  }
  const RECT hostBounds{workspaceBounds.left, workspaceBounds.top,
                        workspaceBounds.left + width,
                        workspaceBounds.top + height};
  const RECT controllerBounds{0, 0, width, height};
  return WindowClientSizeMatches(hostWindow, width, height) &&
         ChildWindowPlacementMatches(hostWindow, hostBounds, placement) &&
         ControllerBoundsMatch(controller, controllerBounds) &&
         ControllerVisibilityMatches(controller, TRUE);
}

bool HiddenAuthSurfaceMatches(HWND authHostWindow,
                              ICoreWebView2Controller* authController) noexcept {
  const bool hostHidden = !authHostWindow || !IsWindow(authHostWindow) ||
                          !IsWindowVisible(authHostWindow);
  const bool controllerHidden = !authController ||
      ControllerVisibilityMatches(authController, FALSE);
  return hostHidden && controllerHidden;
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
  const int width = std::max(1L, workspaceBounds.right - workspaceBounds.left);
  const int height = std::max(1L, workspaceBounds.bottom - workspaceBounds.top);
  const RECT authHostBounds{workspaceBounds.left, workspaceBounds.top,
                            workspaceBounds.left + width,
                            workspaceBounds.top + height};
  const RECT authBounds{0, 0, width, height};
  const bool playbackHidden =
      (!hostWindow || !IsWindow(hostWindow) || !IsWindowVisible(hostWindow)) &&
      (!controller || ControllerVisibilityMatches(controller, FALSE));
  return playbackHidden &&
         WindowClientSizeMatches(authHostWindow, width, height) &&
         ChildWindowPlacementMatches(authHostWindow, authHostBounds, HWND_TOP) &&
         ControllerBoundsMatch(authController, authBounds) &&
         ControllerVisibilityMatches(authController, TRUE);
}

bool ConfiguresSecondaryStationheadWindow(const StationheadConfig& config) noexcept {
  return config.secondaryEnabled && !config.secondaryUrl.empty();
}

RECT ResolveStationheadWorkspaceBounds(StationheadRole role,
                                        const StationheadConfig& config,
                                        HWND parent,
                                        const RECT& requested) noexcept {
  if (role == StationheadRole::Secondary ||
      ConfiguresSecondaryStationheadWindow(config) ||
      !parent || !IsWindow(parent)) {
    return requested;
  }
  RECT client{};
  if (!GetClientRect(parent, &client) ||
      client.right <= client.left || client.bottom <= client.top) {
    return requested;
  }
  return client;
}

struct StationheadSurfacePolicy {
  bool showAuth = false;
  bool showStartupPreview = false;
  bool hidePlaybackForPendingAuth = false;
};

constexpr StationheadSurfacePolicy ResolveStationheadSurfacePolicy(
    bool startupPreviewActive,
    StationheadTabKind selectedTab,
    bool authSurfaceReady) noexcept {
  const bool authSelected = selectedTab == StationheadTabKind::Auth;
  const bool showAuth = authSelected && authSurfaceReady;
  const bool hidePlaybackForPendingAuth = authSelected && !authSurfaceReady;
  return {showAuth,
          startupPreviewActive && !showAuth && !hidePlaybackForPendingAuth,
          hidePlaybackForPendingAuth};
}

static_assert(ResolveStationheadSurfacePolicy(
                  true, StationheadTabKind::None, false).showStartupPreview);
static_assert(ResolveStationheadSurfacePolicy(
                  true, StationheadTabKind::Auth, true).showAuth);
static_assert(!ResolveStationheadSurfacePolicy(
                   true, StationheadTabKind::Auth, true).showStartupPreview);
static_assert(!ResolveStationheadSurfacePolicy(
                   true, StationheadTabKind::Auth, false).showAuth);
static_assert(!ResolveStationheadSurfacePolicy(
                   true, StationheadTabKind::Auth, false).showStartupPreview);
static_assert(ResolveStationheadSurfacePolicy(
                  true, StationheadTabKind::Auth, false).hidePlaybackForPendingAuth);
static_assert(ResolveStationheadSurfacePolicy(
                  false, StationheadTabKind::Auth, true).showAuth);
static_assert(!ResolveStationheadSurfacePolicy(
                   false, StationheadTabKind::Stationhead, true).showStartupPreview);

void ApplyStationheadChildLayout(HWND hostWindow,
                                  HWND authHostWindow,
                                  ICoreWebView2Controller* controller,
                                  ICoreWebView2Controller* authController,
                                  const RECT& bounds,
                                  bool contentVisible,
                                  bool showAuth,
                                  bool previewVisible) {
  const int width = std::max(1L, bounds.right - bounds.left);
  const int height = std::max(1L, bounds.bottom - bounds.top);
  const bool fullContent = previewVisible || contentVisible;
  const int hostWidth = fullContent ? width : 1;
  const int hostHeight = fullContent ? height : 1;
  const RECT contentBounds{0, 0, hostWidth, hostHeight};
  const RECT authBounds{0, 0, width, height};
  const RECT hostBounds{bounds.left, bounds.top, bounds.left + hostWidth, bounds.top + hostHeight};
  const RECT authHostBounds{bounds.left, bounds.top, bounds.left + width, bounds.top + height};
  const HWND hostPlacement = fullContent ? HWND_TOP : HWND_BOTTOM;
  const bool hostValid = hostWindow && IsWindow(hostWindow);
  const bool authHostValid = authHostWindow && IsWindow(authHostWindow);
  const bool hostWasVisible = hostValid && IsWindowVisible(hostWindow);
  const bool authWasVisible = authHostValid && IsWindowVisible(authHostWindow);
  const bool hostSizeMatches = showAuth ||
      (hostValid && WindowClientSizeMatches(hostWindow, hostWidth, hostHeight));
  const bool authHostSizeMatches = !showAuth ||
      (authHostValid && WindowClientSizeMatches(authHostWindow, width, height));
  const bool hostPlacementMatches = hostValid &&
      ChildWindowPlacementMatches(hostWindow, hostBounds, hostPlacement);
  const bool authHostPlacementMatches = authHostValid &&
      ChildWindowPlacementMatches(authHostWindow, authHostBounds, HWND_TOP);

  if (!showAuth && hostValid &&
      (!hostSizeMatches || !hostPlacementMatches)) {
    SetWindowPos(hostWindow, hostPlacement,
                 bounds.left, bounds.top, hostWidth, hostHeight,
                 SWP_NOACTIVATE | SWP_NOSENDCHANGING);
  }
  if (showAuth && authHostValid &&
      (!authHostSizeMatches || !authHostPlacementMatches)) {
    SetWindowPos(authHostWindow, HWND_TOP,
                 bounds.left, bounds.top, width, height,
                 SWP_NOACTIVATE | SWP_NOSENDCHANGING);
  }

  if (showAuth) {
    if (authController) {
      if (!authHostSizeMatches ||
          !ControllerBoundsMatch(authController, authBounds)) {
        authController->put_Bounds(authBounds);
      }
      if (!ControllerVisibilityMatches(authController, TRUE)) {
        authController->put_IsVisible(TRUE);
      }
    }
    if (authHostValid && !authWasVisible) {
      SetWindowPos(authHostWindow, HWND_TOP,
                   bounds.left, bounds.top, width, height,
                   SWP_NOACTIVATE | SWP_SHOWWINDOW | SWP_NOSENDCHANGING);
    }

    if (hostWasVisible) ShowWindow(hostWindow, SW_HIDE);
    if (controller && !ControllerVisibilityMatches(controller, FALSE)) {
      controller->put_IsVisible(FALSE);
    }
    return;
  }

  if (controller) {
    if (!hostSizeMatches ||
        !ControllerBoundsMatch(controller, contentBounds)) {
      controller->put_Bounds(contentBounds);
    }
    if (!ControllerVisibilityMatches(controller, TRUE)) {
      controller->put_IsVisible(TRUE);
    }
  }
  if (hostValid && !hostWasVisible) {
    SetWindowPos(hostWindow, hostPlacement,
                 bounds.left, bounds.top, hostWidth, hostHeight,
                 SWP_NOACTIVATE | SWP_SHOWWINDOW | SWP_NOSENDCHANGING);
  }

  if (authWasVisible) ShowWindow(authHostWindow, SW_HIDE);
  if (authController && !ControllerVisibilityMatches(authController, FALSE)) {
    authController->put_IsVisible(FALSE);
  }
}

}  // namespace

bool StationheadPlayer::EnsureHostWindow() {
  if (hostWindow_ && IsWindow(hostWindow_)) return true;
  hostWindow_ = IsSecondary()
      ? CreateStationheadChildHost(window_, L"HomePanelSecondaryStationheadHost",
                                   L"SecondaryStationheadHost", bounds_)
      : CreateStationheadChildHost(window_, L"HomePanelStationheadHost",
                                   L"StationheadHost", bounds_);
  return hostWindow_ && IsWindow(hostWindow_);
}

bool StationheadPlayer::EnsureAuthHostWindow() {
  if (authControllerStartedAt_.Active() && !authController_) return false;
  if (authHostWindow_ && IsWindow(authHostWindow_)) return true;
  authHostWindow_ = IsSecondary()
      ? CreateStationheadChildHost(window_, L"HomePanelSecondarySpotifyAuthHost",
                                   L"SecondarySpotifyAuthHost", bounds_)
      : CreateStationheadChildHost(window_, L"HomePanelSpotifyAuthHost",
                                   L"SpotifyAuthHost", bounds_);
  return authHostWindow_ && IsWindow(authHostWindow_);
}

void StationheadPlayer::KeepPlaybackBehindDashboard() {
  if (startupPreviewActive_) {
    viewVisible_ = false;
    selectedTab_ = StationheadTabKind::None;
    LayoutControllers();
    return;
  }
  if (!EnsureHostWindow()) {
    viewVisible_ = false;
    std::lock_guard lock(mutex_);
    status_.visible = false;
    return;
  }
  // Playback navigation, audio loss, login detection, and native Start
  // Listening retries are background operations. None of those states may
  // promote the Stationhead playback document over the native dashboard.
  viewVisible_ = false;
  selectedTab_ = StationheadTabKind::None;
  ApplyStationheadChildLayout(hostWindow_, authHostWindow_, controller_.Get(), authController_.Get(),
                              bounds_, false, false, false);
  std::lock_guard lock(mutex_);
  status_.visible = false;
}

void StationheadPlayer::SetStartupBounds() {
  selectedTab_ = StationheadTabKind::None;
  viewVisible_ = false;
  LayoutControllers();
}

void StationheadPlayer::SetStartupPreviewBounds(const RECT& bounds) {
  const int width = std::max(1L, bounds.right - bounds.left);
  const int height = std::max(1L, bounds.bottom - bounds.top);
  if (startupPreviewActive_ && EqualRect(&bounds_, &bounds) &&
      PlaybackSurfaceMatches(hostWindow_, controller_.Get(), bounds,
                             width, height, HWND_TOP) &&
      HiddenAuthSurfaceMatches(authHostWindow_, authController_.Get())) {
    return;
  }
  startupPreviewActive_ = true;
  bounds_ = bounds;
  LayoutControllers();
}

void StationheadPlayer::ClearStartupPreviewBounds() {
  if (!startupPreviewActive_) return;
  const bool preserveAuthTab = selectedTab_ == StationheadTabKind::Auth;
  startupPreviewActive_ = false;
  if (preserveAuthTab) {
    viewVisible_ = true;
    LayoutControllers();
    return;
  }
  SetStartupBounds();
}

void StationheadPlayer::SetVisible(bool visible) {
  if (!visible) {
    if (!viewVisible_ && selectedTab_ == StationheadTabKind::None &&
        !startupPreviewActive_ &&
        PlaybackSurfaceMatches(hostWindow_, controller_.Get(), bounds_,
                               1, 1, HWND_BOTTOM) &&
        HiddenAuthSurfaceMatches(authHostWindow_, authController_.Get())) {
      return;
    }
    const bool hadInteractiveSurface =
        viewVisible_ || selectedTab_ != StationheadTabKind::None;
    const bool interactiveSurfaceHadFocus =
        WindowContainsFocus(hostWindow_) || WindowContainsFocus(authHostWindow_);
    selectedTab_ = StationheadTabKind::None;
    if (controller_) KeepPlaybackBehindDashboard();
    else {
      viewVisible_ = false;
      std::lock_guard lock(mutex_);
      status_.visible = startupPreviewActive_;
    }
    if (hadInteractiveSurface && interactiveSurfaceHadFocus &&
        !startupPreviewActive_ && window_ && IsWindow(window_) &&
        GetFocus() != window_) {
      SetFocus(window_);
    }
    return;
  }

  // Only the separate Spotify authorization controller may be presented after
  // startup. The playback document itself remains 1x1 and behind the dashboard,
  // including login-required and audio-stopped states.
  if (selectedTab_ != StationheadTabKind::Auth) {
    KeepPlaybackBehindDashboard();
    return;
  }
  if (!controller_) {
    viewVisible_ = true;
    std::lock_guard lock(mutex_);
    status_.visible = false;
    return;
  }
  if (viewVisible_ && authController_ && authWebview_ &&
      ActiveAuthSurfaceMatches(hostWindow_, authHostWindow_, controller_.Get(),
                               authController_.Get(), bounds_) &&
      WindowContainsFocus(authHostWindow_)) {
    return;
  }
  viewVisible_ = true;
  LayoutControllers();
  ApplyMute();

  if (authController_ && authHostWindow_ &&
      !WindowContainsFocus(authHostWindow_)) {
    authController_->MoveFocus(COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC);
  }
}

void StationheadPlayer::LayoutControllers() {
  if (!EnsureHostWindow()) {
    std::lock_guard lock(mutex_);
    status_.visible = false;
    return;
  }
  const bool authSurfaceReady = authController_ && authWebview_;
  const StationheadSurfacePolicy policy = ResolveStationheadSurfacePolicy(
      startupPreviewActive_, selectedTab_, authSurfaceReady);
  ApplyStationheadChildLayout(hostWindow_, authHostWindow_, controller_.Get(), authController_.Get(),
                              bounds_, false, policy.showAuth,
                              policy.showStartupPreview);
  std::lock_guard lock(mutex_);
  status_.visible = policy.showStartupPreview || policy.showAuth;
}

void StationheadPlayer::SetBounds(const RECT& bounds) {
  const RECT resolved = ResolveStationheadWorkspaceBounds(role_, config_, window_, bounds);
  if (EqualRect(&bounds_, &resolved)) return;
  bounds_ = resolved;
  if (startupPreviewActive_ || selectedTab_ == StationheadTabKind::Auth) {
    LayoutControllers();
  } else {
    KeepPlaybackBehindDashboard();
  }
}

void StationheadPlayer::SelectTab(StationheadTabKind tab) {
  // StationheadTabKind::Stationhead is an automatic recovery/login surface in
  // the current app. Treat it as a background request. Auth remains separate
  // and may be shown because it requires an explicit OAuth interaction.
  if (tab == StationheadTabKind::Stationhead && !startupPreviewActive_) {
    tab = StationheadTabKind::None;
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
    if (authController_ && authWebview_ &&
        authHostWindow_ && IsWindow(authHostWindow_)) {
      return authHostWindow_;
    }
    return nullptr;
  }
  return nullptr;
}

bool StationheadPlayer::NeedsInteractiveWindow() const {
  return selectedTab_ == StationheadTabKind::Auth || spotifyAuthorization_;
}

}  // namespace hp
