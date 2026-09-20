// Parent/child HWND attachment and targeted message routing.
namespace {
constexpr wchar_t kMainWindowClass[] = L"HomePanelNativeWindow";
constexpr wchar_t kMvPanelWindowClass[] = L"HomePanelNativeMvPanel";
constexpr wchar_t kStationheadHostWindowClass[] = L"HomePanelStationheadHost";
constexpr UINT_PTR kObservedNativeMvAutoStartTimer = 0x4D56;

bool WindowHasClass(HWND window, const wchar_t* expected) {
  wchar_t className[64]{};
  return window && expected &&
      GetClassNameW(window, className, _countof(className)) > 0 &&
      wcscmp(className, expected) == 0;
}

bool IsMainWindow(HWND window) {
  return WindowHasClass(window, kMainWindowClass);
}

bool IsMvPanelWindow(HWND window) {
  return WindowHasClass(window, kMvPanelWindowClass);
}

bool IsStationheadPlaybackHost(HWND window) {
  return WindowHasClass(window, kStationheadHostWindowClass);
}

size_t StationheadServiceTileIndex(HWND window) noexcept {
  wchar_t title[128]{};
  if (!window || GetWindowTextW(window, title, _countof(title)) <= 0) return 0;
  const wchar_t* profile = wcsstr(title, L"spotify-v2-");
  if (!profile) return 0;
  profile += wcslen(L"spotify-v2-");
  wchar_t* end = nullptr;
  const long number = wcstol(profile, &end, 10);
  if (end == profile || number < 1 || number > 6) return 0;
  // Preserve the old Monitor S geometry: profile 6 occupies the original
  // Stationhead tile, while former Spotify profiles 1..5 retain S1..S5.
  return number == 6 ? 0 : static_cast<size_t>(number);
}

bool ChildBoundsMatch(HWND window, const RECT& expected) noexcept {
  if (!window || !IsWindow(window)) return false;
  HWND parent = GetParent(window);
  RECT current{};
  if (!parent || !GetWindowRect(window, &current)) return false;
  POINT topLeft{current.left, current.top};
  POINT bottomRight{current.right, current.bottom};
  if (!ScreenToClient(parent, &topLeft) ||
      !ScreenToClient(parent, &bottomRight)) {
    return false;
  }
  const RECT relative{topLeft.x, topLeft.y, bottomRight.x, bottomRight.y};
  return EqualRect(&relative, &expected);
}

RECT NativeMvForegroundBounds(HWND mvPanel) noexcept {
  RECT fallback{0, 0, 1, 1};
  HWND parent = mvPanel ? GetParent(mvPanel) : nullptr;
  if (!parent || !IsWindow(parent)) return fallback;
  RECT client{};
  if (!GetClientRect(parent, &client)) return fallback;
  client.right = std::max<LONG>(client.left + 1, client.right);
  client.bottom = std::max<LONG>(client.top + 1, client.bottom);

  const LONG totalWidth = std::max<LONG>(1, client.right - client.left);
  const LONG totalHeight = std::max<LONG>(1, client.bottom - client.top);
  LONG videoWidth = std::min<LONG>(
      totalWidth, std::max<LONG>(1, totalHeight * 16 / 9));
  LONG videoHeight = std::max<LONG>(1, videoWidth * 9 / 16);
  if (videoHeight > totalHeight) {
    videoHeight = totalHeight;
    videoWidth = std::min<LONG>(
        totalWidth, std::max<LONG>(1, videoHeight * 16 / 9));
  }
  const LONG left =
      client.left + std::max<LONG>(0, (totalWidth - videoWidth) / 2);
  const LONG top =
      client.top + std::max<LONG>(0, (totalHeight - videoHeight) / 2);
  return RECT{left, top, left + videoWidth, top + videoHeight};
}
}  // namespace

void PowerSavingController::InstallForCurrentThread() {
  if (current_ == this) return;
  if (current_ && current_ != this) {
    throw std::runtime_error("power saving controller is already installed");
  }
  current_ = this;
}

void PowerSavingController::AttachCurrent(HWND parent) {
  PowerSavingController* controller = current_;
  if (!controller || !parent || !IsMainWindow(parent)) return;
  controller->Attach(parent);
}

void PowerSavingController::Uninstall() noexcept {
  Detach();
  if (current_ == this) current_ = nullptr;
}

LRESULT CALLBACK PowerSavingController::ParentSubclassProc(
    HWND window, UINT message, WPARAM wParam, LPARAM lParam,
    UINT_PTR subclassId, DWORD_PTR referenceData) {
  auto* controller = reinterpret_cast<PowerSavingController*>(referenceData);
  if (!controller || subclassId != kParentSubclassId) {
    return ::DefSubclassProc(window, message, wParam, lParam);
  }

  if (message != WM_NCDESTROY) {
    controller->ObserveParentMessage(message, wParam, lParam);
    return ::DefSubclassProc(window, message, wParam, lParam);
  }

  const LRESULT result = ::DefSubclassProc(window, message, wParam, lParam);
  controller->Detach();
  return result;
}

LRESULT CALLBACK PowerSavingController::ChildSubclassProc(
    HWND window, UINT message, WPARAM wParam, LPARAM lParam,
    UINT_PTR subclassId, DWORD_PTR referenceData) {
  auto* controller = reinterpret_cast<PowerSavingController*>(referenceData);
  if (!controller || subclassId != kChildSubclassId) {
    return ::DefSubclassProc(window, message, wParam, lParam);
  }

  if (message == WM_PARENTNOTIFY && LOWORD(wParam) == WM_CREATE) {
    controller->AttachChildWindow(reinterpret_cast<HWND>(lParam));
  }

  if (controller->powerSaving_ && message == WM_TIMER &&
      wParam == kObservedNativeMvAutoStartTimer && IsMvPanelWindow(window)) {
    controller->OpenMvStartupInputPass();
  }

  if ((message == WM_SHOWWINDOW || message == WM_WINDOWPOSCHANGED) &&
      IsStationheadPlaybackHost(window)) {
    // Each Stationhead owns its WebView controller bounds. The monitor router
    // only reasserts the six fixed host tiles after internal layout passes.
    controller->ApplyStationheadMonitorPlacement();
  }

  if (controller->overlay_ && window != controller->overlay_ &&
      (message == WM_SHOWWINDOW || message == WM_WINDOWPOSCHANGED)) {
    PostMessageW(controller->overlay_, kRaiseOverlayMessage, 0, 0);
  }

  if (message == WM_NCDESTROY) {
    ::RemoveWindowSubclass(window, ChildSubclassProc, kChildSubclassId);
  }
  return ::DefSubclassProc(window, message, wParam, lParam);
}

void PowerSavingController::ObserveParentMessage(
    UINT message, WPARAM wParam, LPARAM lParam) {
  if (!parent_) return;

  switch (message) {
    case kStationheadMonitorProbeResultMessage: {
      if (monitorMode_ == MonitorMode::Off) break;
      const unsigned slot = static_cast<unsigned>(lParam);
      if (slot >= 6) break;
      const uint32_t bit = 1u << slot;
      if (wParam != 0) {
        monitorAuthSlots_ |= bit;
      } else {
        monitorAuthSlots_ &= ~bit;
      }
      const bool detected = monitorAuthSlots_ != 0;
      if (monitorAuthForeground_ != detected) {
        monitorAuthForeground_ = detected;
        ApplyStationheadMonitorPlacement();
        ArmScheduleTimer();
      }
      break;
    }
    case WM_DISPLAYCHANGE:
      if (powerSaving_) RefreshMinimumBrightness();
      if (overlay_) PostMessageW(overlay_, kRaiseOverlayMessage, 0, 0);
      break;
    case WM_SIZE:
    case WM_WINDOWPOSCHANGED:
    case WM_SHOWWINDOW:
      ApplyStationheadMonitorPlacement();
      if (overlay_) PostMessageW(overlay_, kRaiseOverlayMessage, 0, 0);
      break;
    case WM_TIMECHANGE:
      CheckSchedule(true);
      break;
    case WM_POWERBROADCAST:
      if (wParam == PBT_APMRESUMEAUTOMATIC ||
          wParam == PBT_APMRESUMESUSPEND) {
        CheckSchedule();
        if (powerSaving_) RefreshMinimumBrightness();
        ApplyStationheadMonitorPlacement();
        LayoutOverlay();
      }
      break;
    case WM_PARENTNOTIFY:
      if (LOWORD(wParam) == WM_CREATE) {
        AttachChildWindow(reinterpret_cast<HWND>(lParam));
      }
      break;
    default:
      break;
  }
}

void PowerSavingController::Attach(HWND parent) {
  if (!parent || parent_ == parent) return;
  Detach();
  parent_ = parent;
  SetLastError(ERROR_SUCCESS);
  if (!::SetWindowSubclass(
          parent_, ParentSubclassProc, kParentSubclassId,
          reinterpret_cast<DWORD_PTR>(this))) {
    const DWORD error = GetLastError() == ERROR_SUCCESS
        ? ERROR_NOT_ENOUGH_MEMORY
        : GetLastError();
    parent_ = nullptr;
    ThrowIfFailed(
        HRESULT_FROM_WIN32(error), "SetWindowSubclass power saving parent");
  }

  // Every fresh dashboard starts on YT for monitor and audio output.
  monitorMode_ = MonitorMode::Native;
  monitorAuthForeground_ = false;
  monitorAuthSlots_ = 0;
  powerSaving_ = false;
  audioMode_ = AudioMode::Media;
  ApplyAudioMode(audioMode_);

  EnumChildWindows(
      parent_,
      [](HWND child, LPARAM value) -> BOOL {
        auto* controller = reinterpret_cast<PowerSavingController*>(value);
        controller->AttachChildWindow(child);
        return TRUE;
      },
      reinterpret_cast<LPARAM>(this));

  try {
    EnsureOverlay();
    CheckSchedule(true);
    ApplyStationheadMonitorPlacement();
    LayoutOverlay();
  } catch (...) {
    Detach();
    throw;
  }
}

void PowerSavingController::AttachChildWindow(HWND window) noexcept {
  if (!parent_ || !window || window == overlay_ || !IsWindow(window)) return;

  ::SetWindowSubclass(
      window, ChildSubclassProc, kChildSubclassId,
      reinterpret_cast<DWORD_PTR>(this));
  if (IsStationheadPlaybackHost(window)) {
    // A recreated Stationhead host must inherit the currently selected output
    // route rather than globally muting all six windows.
    ApplyAudioMode(audioMode_);
    ApplyStationheadMonitorPlacement();
  } else if (IsMvPanelWindow(window)) {
    ApplyStationheadMonitorPlacement();
  }
}

void PowerSavingController::ApplyStationheadMonitorPlacement() noexcept {
  if (!parent_ || !IsWindow(parent_)) return;

  const bool serviceGrid = monitorMode_ == MonitorMode::ServiceGrid;
  const bool nativeMediaForeground =
      monitorMode_ == MonitorMode::Native && !monitorAuthForeground_;

  if (SetStationheadMonitorForeground(serviceGrid)) {
    PostMessageW(parent_, WM_TIMER, 0, 0);
  }

  RECT parentClient{0, 0, 1, 1};
  GetClientRect(parent_, &parentClient);

  struct Context {
    PowerSavingController* controller;
    bool serviceGrid;
    bool nativeMediaForeground;
    RECT parentClient;
  } context{this, serviceGrid, nativeMediaForeground, parentClient};

  EnumChildWindows(
      parent_,
      [](HWND child, LPARAM value) -> BOOL {
        auto* context = reinterpret_cast<Context*>(value);
        PowerSavingController* controller = context->controller;

        if (IsMvPanelWindow(child)) {
          const RECT target = context->nativeMediaForeground
              ? NativeMvForegroundBounds(child)
              : RECT{0, 0, 1, 1};
          if (!ChildBoundsMatch(child, target) || !IsWindowVisible(child)) {
            SetWindowPos(
                child, nullptr,
                target.left, target.top,
                std::max<LONG>(1, target.right - target.left),
                std::max<LONG>(1, target.bottom - target.top),
                SWP_NOACTIVATE | SWP_SHOWWINDOW | SWP_NOSENDCHANGING |
                    SWP_NOZORDER);
          }
          return TRUE;
        }

        if (!IsStationheadPlaybackHost(child) || !context->serviceGrid) {
          return TRUE;
        }

        const size_t tileIndex = StationheadServiceTileIndex(child);
        const RECT target = ServiceMonitorTileBounds(context->parentClient, tileIndex);
        const HWND insertAfter = controller->overlay_
            ? controller->overlay_
            : HWND_TOP;
        if (!ChildBoundsMatch(child, target) || !IsWindowVisible(child)) {
          SetWindowPos(
              child, insertAfter,
              target.left, target.top,
              std::max<LONG>(1, target.right - target.left),
              std::max<LONG>(1, target.bottom - target.top),
              SWP_NOACTIVATE | SWP_SHOWWINDOW | SWP_NOSENDCHANGING);
        }
        return TRUE;
      },
      reinterpret_cast<LPARAM>(&context));
}

void PowerSavingController::Detach() noexcept {
  RestoreBrightness();
  mvStartupInputPass_ = false;
  monitorAuthForeground_ = false;
  monitorAuthSlots_ = 0;
  SetStationheadMonitorForeground(false);
  if (parent_ && IsWindow(parent_)) {
    EnumChildWindows(
        parent_,
        [](HWND child, LPARAM) -> BOOL {
          ::RemoveWindowSubclass(
              child, PowerSavingController::ChildSubclassProc,
              PowerSavingController::kChildSubclassId);
          return TRUE;
        },
        0);
    ::RemoveWindowSubclass(parent_, ParentSubclassProc, kParentSubclassId);
  }
  if (overlay_ && IsWindow(overlay_)) {
    KillTimer(overlay_, kScheduleTimer);
    KillTimer(overlay_, kMvStartupPassTimer);
    DestroyWindow(overlay_);
  }
  overlay_ = nullptr;
  parent_ = nullptr;
  scheduleInitialized_ = false;
  nextScheduleBoundaryAt_ = 0;
}