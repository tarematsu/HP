// Native MV host HWND registration, message dispatch and bounds management.
extern fs::path gNativeMediaDataDir;

bool EnsureNativeMvPanel(HWND parentWindow, const fs::path& dataDir,
                         const RECT& bounds) noexcept;

fs::path gNativeMediaDataDir;

bool RecreateNativeMediaPanel(HWND hwnd) noexcept {
  if (!hwnd || !IsWindow(hwnd)) return false;
  HWND parentWindow = GetParent(hwnd);
  if (!parentWindow || !IsWindow(parentWindow) || gNativeMediaDataDir.empty()) {
    return false;
  }
  RECT bounds{};
  if (!GetClientRect(parentWindow, &bounds) ||
      bounds.right <= bounds.left || bounds.bottom <= bounds.top) {
    return false;
  }
  fs::path dataDir;
  try {
    dataDir = gNativeMediaDataDir;
  } catch (...) {
    return false;
  }
  if (!DestroyWindow(hwnd)) return false;
  return EnsureNativeMvPanel(parentWindow, dataDir, bounds);
}

LRESULT CALLBACK NativeMediaPanelWndProc(
    HWND hwnd, UINT message, WPARAM wparam, LPARAM lparam) {
  NativeMediaPanelHost* host = reinterpret_cast<NativeMediaPanelHost*>(
      GetWindowLongPtrW(hwnd, GWLP_USERDATA));
  if (message == WM_NCCREATE) {
    const auto* create = reinterpret_cast<CREATESTRUCTW*>(lparam);
    host = static_cast<NativeMediaPanelHost*>(create->lpCreateParams);
    if (host) {
      host->Attach(hwnd);
      SetWindowLongPtrW(hwnd, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(host));
    }
  }
  if (host) {
    switch (message) {
      case kNativeMediaRecreateMessage:
        RecreateNativeMediaPanel(hwnd);
        return 0;
      case WM_SIZE:
        host->Resize();
        return 0;
      case WM_TIMER: {
        const UINT_PTR timerId = static_cast<UINT_PTR>(wparam);
        if ((timerId == kNativeMediaYoutubeWatchdogTimer ||
             timerId == kNativeMediaTverWatchdogTimer) &&
            NativeMediaWatchdogExecutionTimedOut(hwnd, timerId)) {
          PostMessageW(hwnd, kNativeMediaRecreateMessage, 0, 0);
          return 0;
        }
        if (host->OnTimer(timerId)) return 0;
        break;
      }
      case WM_ERASEBKGND:
        return 1;
      case WM_PAINT:
        host->Paint();
        return 0;
      case WM_NCDESTROY:
        NativeMediaForgetWatchdogExecution(hwnd);
        SetWindowLongPtrW(hwnd, GWLP_USERDATA, 0);
        host->Shutdown();
        delete host;
        return DefWindowProcW(hwnd, message, wparam, lparam);
      default:
        break;
    }
  }
  return DefWindowProcW(hwnd, message, wparam, lparam);
}

bool EnsureNativeMvPanel(HWND parentWindow, const fs::path& dataDir,
                         const RECT& bounds) noexcept {
  if (!parentWindow || !IsWindow(parentWindow) ||
      bounds.right <= bounds.left || bounds.bottom <= bounds.top) {
    return false;
  }
  try {
    if (gNativeMediaDataDir != dataDir) gNativeMediaDataDir = dataDir;
  } catch (...) {
    return false;
  }
  static std::once_flag once;
  static bool registered = false;
  std::call_once(once, [] {
    WNDCLASSW windowClass{};
    windowClass.lpfnWndProc = NativeMediaPanelWndProc;
    windowClass.hInstance = GetModuleHandleW(nullptr);
    windowClass.lpszClassName = kNativeMvPanelHostClass;
    windowClass.hCursor = nullptr;
    windowClass.hbrBackground =
        static_cast<HBRUSH>(GetStockObject(BLACK_BRUSH));
    SetLastError(ERROR_SUCCESS);
    registered = RegisterClassW(&windowClass) != 0 ||
                 GetLastError() == ERROR_CLASS_ALREADY_EXISTS;
  });
  if (!registered) return false;

  const LONG totalWidth = std::max(1L, bounds.right - bounds.left);
  const LONG totalHeight = std::max(1L, bounds.bottom - bounds.top);

  // The retired Spotify/Stationhead status strip no longer consumes vertical
  // space. Fit YouTube/TVer directly into the full media cell at 16:9.
  LONG videoWidth = std::min<LONG>(
      totalWidth, std::max<LONG>(1, totalHeight * 16 / 9));
  LONG videoHeight = std::max<LONG>(1, videoWidth * 9 / 16);
  if (videoHeight > totalHeight) {
    videoHeight = totalHeight;
    videoWidth = std::min<LONG>(
        totalWidth, std::max<LONG>(1, videoHeight * 16 / 9));
  }
  const LONG contentLeft =
      bounds.left + std::max<LONG>(0, (totalWidth - videoWidth) / 2);
  const LONG contentTop =
      bounds.top + std::max<LONG>(0, (totalHeight - videoHeight) / 2);

  RECT videoBounds = bounds;
  videoBounds.left = contentLeft;
  videoBounds.top = contentTop;
  videoBounds.right = contentLeft + videoWidth;
  videoBounds.bottom = contentTop + videoHeight;

  HWND host = FindWindowExW(
      parentWindow, nullptr, kNativeMvPanelHostClass, nullptr);
  if (!host) {
    auto* state = new (std::nothrow) NativeMediaPanelHost(dataDir);
    if (!state) return false;
    host = CreateWindowExW(
        0, kNativeMvPanelHostClass, L"",
        WS_CHILD | WS_CLIPCHILDREN | WS_CLIPSIBLINGS | WS_VISIBLE,
        videoBounds.left, videoBounds.top,
        std::max(1L, videoBounds.right - videoBounds.left),
        std::max(1L, videoBounds.bottom - videoBounds.top), parentWindow, nullptr,
        GetModuleHandleW(nullptr), state);
    if (!host) {
      delete state;
      return false;
    }
    state->Start();
    return true;
  }

  RECT current{};
  GetWindowRect(host, &current);
  MapWindowPoints(nullptr, parentWindow, reinterpret_cast<POINT*>(&current), 2);
  if (!EqualRect(&current, &videoBounds)) {
    SetWindowPos(
        host, nullptr, videoBounds.left, videoBounds.top,
        std::max(1L, videoBounds.right - videoBounds.left),
        std::max(1L, videoBounds.bottom - videoBounds.top),
        SWP_NOACTIVATE | SWP_NOSENDCHANGING | SWP_NOZORDER | SWP_SHOWWINDOW);
  }
  return true;
}
