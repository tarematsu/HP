// Native MV host HWND registration, Spotify status strip, message dispatch and
// bounds management.
namespace {
constexpr wchar_t kNativeSpotifyStatusClass[] = L"HomePanelNativeSpotifyStatus";
constexpr LONG kNativeSpotifyStatusHeight = 56;
constexpr UINT_PTR kNativeSpotifyStatusPollTimer = 0x5350;
constexpr UINT kNativeSpotifyStatusPollMs = 60U * 1000U;
constexpr COLORREF kSpotifyStatusBackground = RGB(7, 10, 16);
constexpr COLORREF kSpotifyStatusSurface = RGB(20, 26, 36);
constexpr COLORREF kSpotifyStatusOutline = RGB(43, 54, 69);

HBRUSH SpotifyStatusBackgroundBrush() noexcept {
  static HBRUSH brush = CreateSolidBrush(kSpotifyStatusBackground);
  return brush;
}

LRESULT CALLBACK NativeSpotifyStatusWndProc(
    HWND hwnd, UINT message, WPARAM wparam, LPARAM lparam) {
  switch (message) {
    case WM_TIMER:
      if (static_cast<UINT_PTR>(wparam) == kNativeSpotifyStatusPollTimer) {
        PollSpotifyPlaybackStatusesNow();
        return 0;
      }
      break;
    case WM_ERASEBKGND:
      return 1;
    case WM_PAINT: {
      PAINTSTRUCT paint{};
      HDC dc = BeginPaint(hwnd, &paint);
      if (!dc) return 0;
      RECT client{};
      GetClientRect(hwnd, &client);
      const int width = std::max(1L, client.right - client.left);
      const int height = std::max(1L, client.bottom - client.top);
      HDC memoryDc = CreateCompatibleDC(dc);
      HBITMAP bitmap = memoryDc ? CreateCompatibleBitmap(dc, width, height) : nullptr;
      HGDIOBJ previousBitmap =
          memoryDc && bitmap ? SelectObject(memoryDc, bitmap) : nullptr;
      HDC paintDc = memoryDc && bitmap ? memoryDc : dc;

      FillRect(paintDc, &client, SpotifyStatusBackgroundBrush());
      SetBkMode(paintDc, TRANSPARENT);
      SetTextColor(paintDc, RGB(225, 229, 235));
      HGDIOBJ previousFont =
          SelectObject(paintDc, GetStockObject(DEFAULT_GUI_FONT));

      const auto statuses = GetSpotifyPlaybackStatuses();
      const LONG stripWidth = std::max(1L, client.right - client.left);
      constexpr LONG outerInset = 3;
      constexpr LONG cardGap = 4;
      HBRUSH cardBrush = CreateSolidBrush(kSpotifyStatusSurface);
      HPEN cardPen = CreatePen(PS_SOLID, 1, kSpotifyStatusOutline);
      HGDIOBJ previousBrush = SelectObject(paintDc, cardBrush);
      HGDIOBJ previousPen = SelectObject(paintDc, cardPen);

      for (size_t i = 0; i < statuses.size(); ++i) {
        const LONG cellLeft = client.left +
            static_cast<LONG>((static_cast<long long>(stripWidth) * i) /
                              statuses.size());
        const LONG cellRight = client.left +
            static_cast<LONG>((static_cast<long long>(stripWidth) * (i + 1)) /
                              statuses.size());
        const LONG leftInset = outerInset + (i == 0 ? 0 : cardGap / 2);
        const LONG rightInset = outerInset +
            (i + 1 == statuses.size() ? 0 : cardGap - cardGap / 2);
        RECT card{
            cellLeft + leftInset,
            client.top + outerInset,
            std::max<LONG>(cellLeft + leftInset + 1, cellRight - rightInset),
            std::max<LONG>(client.top + outerInset + 1,
                           client.bottom - outerInset)};
        const int radius = std::max(8L, std::min(16L, card.bottom - card.top));
        RoundRect(paintDc, card.left, card.top, card.right, card.bottom,
                  radius, radius);

        RECT first{card.left + 8, card.top + 3, card.right - 8, card.top + 22};
        RECT second{card.left + 8, card.top + 24, card.right - 8, card.bottom - 3};
        const std::wstring& heading = statuses[i].windowName;
        const std::wstring& track = statuses[i].trackTitle;
        const wchar_t* trackText = track.empty() ? L"--" : track.c_str();
        DrawTextW(paintDc, heading.c_str(), -1, &first,
                  DT_LEFT | DT_SINGLELINE | DT_VCENTER | DT_END_ELLIPSIS |
                      DT_NOPREFIX);
        DrawTextW(paintDc, trackText, -1, &second,
                  DT_LEFT | DT_SINGLELINE | DT_VCENTER | DT_END_ELLIPSIS |
                      DT_NOPREFIX);
      }

      SelectObject(paintDc, previousPen);
      SelectObject(paintDc, previousBrush);
      DeleteObject(cardPen);
      DeleteObject(cardBrush);
      if (previousFont && previousFont != HGDI_ERROR) {
        SelectObject(paintDc, previousFont);
      }
      if (paintDc != dc) {
        BitBlt(dc, 0, 0, width, height, paintDc, 0, 0, SRCCOPY);
      }
      if (memoryDc && bitmap) {
        SelectObject(memoryDc, previousBitmap);
        DeleteObject(bitmap);
      }
      if (memoryDc) DeleteDC(memoryDc);
      EndPaint(hwnd, &paint);
      return 0;
    }
    case WM_NCDESTROY:
      KillTimer(hwnd, kNativeSpotifyStatusPollTimer);
      break;
    default:
      break;
  }
  return DefWindowProcW(hwnd, message, wparam, lparam);
}

bool EnsureNativeSpotifyStatusPanel(HWND parentWindow, const RECT& bounds) noexcept {
  static std::once_flag once;
  static bool registered = false;
  std::call_once(once, [] {
    WNDCLASSW windowClass{};
    windowClass.lpfnWndProc = NativeSpotifyStatusWndProc;
    windowClass.hInstance = GetModuleHandleW(nullptr);
    windowClass.lpszClassName = kNativeSpotifyStatusClass;
    windowClass.hCursor = nullptr;
    windowClass.hbrBackground = SpotifyStatusBackgroundBrush();
    SetLastError(ERROR_SUCCESS);
    registered = RegisterClassW(&windowClass) != 0 ||
                 GetLastError() == ERROR_CLASS_ALREADY_EXISTS;
  });
  if (!registered) return false;

  HWND status = FindWindowExW(parentWindow, nullptr, kNativeSpotifyStatusClass, nullptr);
  if (!status) {
    status = CreateWindowExW(
        0, kNativeSpotifyStatusClass, L"",
        WS_CHILD | WS_CLIPSIBLINGS | WS_VISIBLE,
        bounds.left, bounds.top, std::max(1L, bounds.right - bounds.left),
        std::max(1L, bounds.bottom - bounds.top), parentWindow, nullptr,
        GetModuleHandleW(nullptr), nullptr);
    if (!status) return false;
    SetTimer(status, kNativeSpotifyStatusPollTimer,
             kNativeSpotifyStatusPollMs, nullptr);
  } else {
    RECT current{};
    GetWindowRect(status, &current);
    MapWindowPoints(nullptr, parentWindow, reinterpret_cast<POINT*>(&current), 2);
    if (!EqualRect(&current, &bounds)) {
      SetWindowPos(status, nullptr, bounds.left, bounds.top,
                   std::max(1L, bounds.right - bounds.left),
                   std::max(1L, bounds.bottom - bounds.top),
                   SWP_NOACTIVATE | SWP_NOSENDCHANGING | SWP_NOZORDER |
                       SWP_SHOWWINDOW);
    }
  }
  return true;
}
}  // namespace

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

  const LONG totalHeight = std::max(1L, bounds.bottom - bounds.top);
  const LONG statusHeight = std::min(
      kNativeSpotifyStatusHeight, std::max(1L, totalHeight / 3));
  RECT statusBounds = bounds;
  statusBounds.bottom = statusBounds.top + statusHeight;
  RECT videoBounds = bounds;
  videoBounds.top = std::min(videoBounds.bottom - 1, statusBounds.bottom);

  if (!EnsureNativeSpotifyStatusPanel(parentWindow, statusBounds)) return false;

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
