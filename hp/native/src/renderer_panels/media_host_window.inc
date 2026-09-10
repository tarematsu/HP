// Native MV host HWND registration, message dispatch and bounds management.
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
      case WM_SIZE:
        host->Resize();
        return 0;
      case WM_TIMER:
        if (host->OnTimer(static_cast<UINT_PTR>(wparam))) return 0;
        break;
      case WM_ERASEBKGND:
        return 1;
      case WM_PAINT:
        host->Paint();
        return 0;
      case WM_NCDESTROY:
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

  HWND host = FindWindowExW(
      parentWindow, nullptr, kNativeMvPanelHostClass, nullptr);
  if (!host) {
    auto* state = new (std::nothrow) NativeMediaPanelHost(dataDir);
    if (!state) return false;
    host = CreateWindowExW(
        0, kNativeMvPanelHostClass, L"",
        WS_CHILD | WS_CLIPCHILDREN | WS_CLIPSIBLINGS | WS_VISIBLE,
        bounds.left, bounds.top, std::max(1L, bounds.right - bounds.left),
        std::max(1L, bounds.bottom - bounds.top), parentWindow, nullptr,
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
  if (!EqualRect(&current, &bounds)) {
    SetWindowPos(
        host, HWND_TOP, bounds.left, bounds.top,
        std::max(1L, bounds.right - bounds.left),
        std::max(1L, bounds.bottom - bounds.top),
        SWP_NOACTIVATE | SWP_NOSENDCHANGING | SWP_SHOWWINDOW);
  }
  return true;
}
