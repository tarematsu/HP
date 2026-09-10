// Parent/child HWND attachment and targeted message routing.
namespace {
constexpr wchar_t kMainWindowClass[] = L"HomePanelNativeWindow";
constexpr wchar_t kMvPanelWindowClass[] = L"HomePanelNativeMvPanel";
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
    case WM_DISPLAYCHANGE:
      if (powerSaving_) RefreshMinimumBrightness();
      if (overlay_) PostMessageW(overlay_, kRaiseOverlayMessage, 0, 0);
      break;
    case WM_SIZE:
    case WM_WINDOWPOSCHANGED:
    case WM_SHOWWINDOW:
    case WM_TIMER:
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
}

void PowerSavingController::Detach() noexcept {
  RestoreBrightness();
  mvStartupInputPass_ = false;
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
