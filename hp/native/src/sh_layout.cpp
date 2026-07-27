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
  // Reuse each synchronous Win32 size read for both host placement and
  // WebView2 bounds repair. If the host was resized, its controller bounds
  // are already known to require an update, so no COM bounds read is needed.
  const bool hostSizeMatches = showAuth ||
      (hostValid && WindowClientSizeMatches(hostWindow, hostWidth, hostHeight));
  const bool authHostSizeMatches = !showAuth ||
      (authHostValid && WindowClientSizeMatches(authHostWindow, width, height));
  const bool hostPlacementMatches = hostValid &&
      ChildWindowPlacementMatches(hostWindow, hostBounds, hostPlacement);
  const bool authHostPlacementMatches = authHostValid &&
      ChildWindowPlacementMatches(authHostWindow, authHostBounds, HWND_TOP);

  // Prepare the destination host while it is still hidden. WebView2 controller
  // bounds and visibility are then committed before the destination host is
  // exposed, so playback/auth transitions cannot reveal an empty child window.
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

    // The replacement surface is now complete and on top. Retire playback only
    // after that point to avoid a transient dashboard/black frame between them.
    if (hostWasVisible) ShowWindow(hostWindow, SW_HIDE);
    if (controller && !ControllerVisibilityMatches(controller, FALSE)) {
      controller->put_IsVisible(FALSE);
    }
    return;
  }

  if (controller) {
    // Check the host first. A resize makes the controller update mandatory,
    // so avoid a synchronous WebView2 COM read on that common transition.
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

  // Playback is now ready, including the stable 1x1 behind-dashboard state.
  // Hide the old auth surface last so every transition retains a complete frame.
  if (authWasVisible) ShowWindow(authHostWindow, SW_HIDE);
  if (authController && !ControllerVisibilityMatches(authController, FALSE)) {
    authController->put_IsVisible(FALSE);
  }
}

}

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
  // Repeated authorization requests update authPendingUrl_. While one profile
  // controller is already being created, retain that latest URL and let the
  // existing callback navigate it instead of starting a second controller for
  // the same host/profile. CloseAuthWebView() clears the timestamp before an
  // intentional replacement can begin.
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
  if (spotifyAuthorization_ || loginRequired_) {
    selectedTab_ = spotifyAuthorization_
        ? StationheadTabKind::Auth
        : StationheadTabKind::Stationhead;
    viewVisible_ = true;
    LayoutControllers();
    return;
  }
  if (startupPreviewActive_) {
    // The App owns the startup-preview lifetime. A player can request to hide
    // after audio starts or auth completes, but clearing only this local flag
    // desynchronizes it from the A/B handle and leaves a blank half-screen.
    // Keep the preview surface until App::ClearStartupStationheadPreview()
    // releases both players together.
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
  const bool preserveInteractiveTab =
      selectedTab_ != StationheadTabKind::None && NeedsInteractiveWindow();
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
    // Audio and render-state notifications can converge on the same hide request.
    // Verify the stable 1x1 playback surface before skipping all layout writes;
    // a stale or externally disturbed host/controller still takes the repair path.
    if (!viewVisible_ && selectedTab_ == StationheadTabKind::None &&
        !startupPreviewActive_ && !spotifyAuthorization_ && !loginRequired_ &&
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
  if (selectedTab_ == StationheadTabKind::None && !NeedsInteractiveWindow()) {
    selectedTab_ = StationheadTabKind::Stationhead;
  }
  if (!controller_) {
    viewVisible_ = selectedTab_ != StationheadTabKind::None || NeedsInteractiveWindow();
    std::lock_guard lock(mutex_);
    status_.visible = startupPreviewActive_ || viewVisible_;
    return;
  }
  if (selectedTab_ == StationheadTabKind::None && !NeedsInteractiveWindow()) {
    KeepPlaybackBehindDashboard();
    return;
  }
  // Re-selecting the active surface is common while login/auth state settles.
  // Skip writes only after confirming geometry, visibility, and keyboard focus
  // already belong to the selected WebView2 surface.
  if (viewVisible_) {
    const int width = std::max(1L, bounds_.right - bounds_.left);
    const int height = std::max(1L, bounds_.bottom - bounds_.top);
    if (selectedTab_ == StationheadTabKind::Stationhead &&
        PlaybackSurfaceMatches(hostWindow_, controller_.Get(), bounds_,
                               width, height, HWND_TOP) &&
        HiddenAuthSurfaceMatches(authHostWindow_, authController_.Get()) &&
        WindowContainsFocus(hostWindow_)) {
      return;
    }
    if (selectedTab_ == StationheadTabKind::Auth && authController_ && authWebview_ &&
        ActiveAuthSurfaceMatches(hostWindow_, authHostWindow_, controller_.Get(),
                                 authController_.Get(), bounds_) &&
        WindowContainsFocus(authHostWindow_)) {
      return;
    }
  }
  viewVisible_ = true;
  LayoutControllers();
  ApplyMute();

  ICoreWebView2Controller* activeController = controller_.Get();
  HWND activeHost = hostWindow_;
  if (selectedTab_ == StationheadTabKind::Auth) {
    activeController = authController_.Get();
    activeHost = authHostWindow_;
  }
  if (activeController && activeHost && !WindowContainsFocus(activeHost)) {
    activeController->MoveFocus(COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC);
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
  const bool contentVisible = viewVisible_ && !policy.hidePlaybackForPendingAuth;
  ApplyStationheadChildLayout(hostWindow_, authHostWindow_, controller_.Get(), authController_.Get(),
                              bounds_, contentVisible, policy.showAuth,
                              policy.showStartupPreview);
  std::lock_guard lock(mutex_);
  status_.visible = policy.showStartupPreview || policy.showAuth || contentVisible;
}

void StationheadPlayer::SetBounds(const RECT& bounds) {
  const RECT resolved = ResolveStationheadWorkspaceBounds(role_, config_, window_, bounds);
  if (EqualRect(&bounds_, &resolved)) return;
  bounds_ = resolved;
  if (startupPreviewActive_ || viewVisible_ || NeedsInteractiveWindow()) LayoutControllers();
  else KeepPlaybackBehindDashboard();
}

void StationheadPlayer::SelectTab(StationheadTabKind tab) {
  if (tab == StationheadTabKind::None && NeedsInteractiveWindow()) {
    tab = spotifyAuthorization_ ? StationheadTabKind::Auth : StationheadTabKind::Stationhead;
  }
  if (selectedTab_ == tab) {
    if (tab == StationheadTabKind::None && !viewVisible_) return;
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
    // The playback surface is intentionally collapsed while an auth controller
    // is pending. Do not raise that 1x1 host over the dashboard as a substitute.
    return nullptr;
  }
  return hostWindow_;
}

bool StationheadPlayer::NeedsInteractiveWindow() const {
  return selectedTab_ == StationheadTabKind::Auth ||
         spotifyAuthorization_ ||
         loginRequired_ ||
         (controller_ && !AudioPlaying());
}

}  // namespace hp
