namespace {
constexpr wchar_t kShiftOverlayClassName[] = L"HomePanelShiftOverlay";
constexpr wchar_t kShiftOverlayText[] = L"9/2 水曜日 夜勤";
constexpr wchar_t kShiftOverlayWindowProperty[] = L"HomePanelShiftOverlayWindow";
constexpr wchar_t kShiftOverlayVisibleProperty[] = L"HomePanelShiftOverlayVisible";
constexpr UINT_PTR kShiftOverlayTimer = 1;
constexpr UINT kShiftOverlaySyncMs = 250;
constexpr COLORREF kShiftOverlayColorKey = RGB(1, 2, 3);

HFONT CreateShiftOverlayFont(int height) {
  return CreateFontW(-std::max(1, height), 0, 0, 0, FW_BOLD,
                     FALSE, FALSE, FALSE, DEFAULT_CHARSET,
                     OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS,
                     ANTIALIASED_QUALITY, DEFAULT_PITCH | FF_DONTCARE,
                     DashboardFontFace());
}

bool ShiftOverlayDesiredVisible(HWND overlay) {
  return GetPropW(overlay, kShiftOverlayVisibleProperty) != nullptr;
}

void SyncShiftOverlay(HWND overlay, HWND owner) {
  if (!overlay || !IsWindow(overlay) || !owner || !IsWindow(owner)) return;

  RECT client{};
  POINT topLeft{};
  POINT bottomRight{};
  if (!GetClientRect(owner, &client)) return;
  topLeft = POINT{client.left, client.top};
  bottomRight = POINT{client.right, client.bottom};
  if (!ClientToScreen(owner, &topLeft) || !ClientToScreen(owner, &bottomRight)) return;

  const bool show = ShiftOverlayDesiredVisible(overlay) &&
                    IsWindowVisible(owner) && !IsIconic(owner);
  SetWindowPos(overlay, nullptr,
               topLeft.x, topLeft.y,
               std::max(1L, bottomRight.x - topLeft.x),
               std::max(1L, bottomRight.y - topLeft.y),
               SWP_NOZORDER | SWP_NOACTIVATE | SWP_NOSENDCHANGING |
                   (show ? SWP_SHOWWINDOW : SWP_HIDEWINDOW));
  if (show) InvalidateRect(overlay, nullptr, FALSE);
}

void PaintShiftOverlay(HWND hwnd) {
  PAINTSTRUCT paint{};
  HDC dc = BeginPaint(hwnd, &paint);
  if (!dc) return;

  RECT bounds{};
  GetClientRect(hwnd, &bounds);
  HBRUSH keyBrush = CreateSolidBrush(kShiftOverlayColorKey);
  FillRect(dc, &bounds, keyBrush);
  DeleteObject(keyBrush);

  const int width = std::max(1L, bounds.right - bounds.left);
  const int height = std::max(1L, bounds.bottom - bounds.top);
  int fontHeight = std::clamp(height * 240 / 1000, 64, 360);
  HFONT font = CreateShiftOverlayFont(fontHeight);
  if (!font) {
    EndPaint(hwnd, &paint);
    return;
  }

  HGDIOBJ previousFont = SelectObject(dc, font);
  SIZE extent{};
  if (GetTextExtentPoint32W(dc, kShiftOverlayText,
                            static_cast<int>(wcslen(kShiftOverlayText)), &extent)) {
    const int targetWidth = std::max(1, width * 92 / 100);
    if (extent.cx > targetWidth) {
      SelectObject(dc, previousFont);
      DeleteObject(font);
      fontHeight = std::max(24, fontHeight * targetWidth / std::max(1L, extent.cx));
      font = CreateShiftOverlayFont(fontHeight);
      if (!font) {
        EndPaint(hwnd, &paint);
        return;
      }
      previousFont = SelectObject(dc, font);
    }
  }

  SetBkMode(dc, TRANSPARENT);
  const int outline = std::clamp(height * 4 / 1000, 2, 6);
  SetTextColor(dc, RGB(0, 0, 0));
  for (int dy : {-outline, 0, outline}) {
    for (int dx : {-outline, 0, outline}) {
      if (dx == 0 && dy == 0) continue;
      RECT shadow = bounds;
      OffsetRect(&shadow, dx, dy);
      DrawTextW(dc, kShiftOverlayText, -1, &shadow,
                DT_CENTER | DT_VCENTER | DT_SINGLELINE | DT_NOPREFIX);
    }
  }

  SetTextColor(dc, RGB(255, 255, 255));
  DrawTextW(dc, kShiftOverlayText, -1, &bounds,
            DT_CENTER | DT_VCENTER | DT_SINGLELINE | DT_NOPREFIX);

  SelectObject(dc, previousFont);
  DeleteObject(font);
  EndPaint(hwnd, &paint);
}

LRESULT CALLBACK ShiftOverlayWndProc(HWND hwnd, UINT message,
                                     WPARAM wparam, LPARAM lparam) {
  switch (message) {
    case WM_CREATE:
      SetTimer(hwnd, kShiftOverlayTimer, kShiftOverlaySyncMs, nullptr);
      return 0;
    case WM_TIMER:
      if (wparam == kShiftOverlayTimer) {
        SyncShiftOverlay(hwnd, GetWindow(hwnd, GW_OWNER));
        return 0;
      }
      break;
    case WM_NCHITTEST:
      return HTTRANSPARENT;
    case WM_MOUSEACTIVATE:
      return MA_NOACTIVATE;
    case WM_ERASEBKGND:
      return 1;
    case WM_PAINT:
      PaintShiftOverlay(hwnd);
      return 0;
    case WM_NCDESTROY: {
      KillTimer(hwnd, kShiftOverlayTimer);
      HWND owner = GetWindow(hwnd, GW_OWNER);
      if (owner && IsWindow(owner)) {
        RemovePropW(owner, kShiftOverlayWindowProperty);
      }
      RemovePropW(hwnd, kShiftOverlayVisibleProperty);
      break;
    }
  }
  return DefWindowProcW(hwnd, message, wparam, lparam);
}

HWND EnsureShiftOverlay(HWND owner) {
  if (!owner || !IsWindow(owner)) return nullptr;
  HWND overlay = reinterpret_cast<HWND>(
      GetPropW(owner, kShiftOverlayWindowProperty));
  if (overlay && IsWindow(overlay)) return overlay;

  static std::once_flag classOnce;
  static bool classReady = false;
  std::call_once(classOnce, [] {
    WNDCLASSW windowClass{};
    windowClass.lpfnWndProc = ShiftOverlayWndProc;
    windowClass.hInstance = GetModuleHandleW(nullptr);
    windowClass.lpszClassName = kShiftOverlayClassName;
    windowClass.hCursor = LoadCursorW(nullptr, IDC_ARROW);
    windowClass.hbrBackground = nullptr;
    SetLastError(ERROR_SUCCESS);
    classReady = RegisterClassW(&windowClass) != 0 ||
                 GetLastError() == ERROR_CLASS_ALREADY_EXISTS;
  });
  if (!classReady) return nullptr;

  overlay = CreateWindowExW(
      WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW,
      kShiftOverlayClassName, L"", WS_POPUP,
      0, 0, 1, 1, owner, nullptr, GetModuleHandleW(nullptr), nullptr);
  if (!overlay) return nullptr;

  SetLayeredWindowAttributes(overlay, kShiftOverlayColorKey, 255, LWA_COLORKEY);
  SetPropW(owner, kShiftOverlayWindowProperty, overlay);
  return overlay;
}

void PlaceNativeWindow(HWND hwnd, const RECT& rect, bool visible) {
  BasePlaceNativeWindow(hwnd, rect, visible);

  HWND owner = GetParent(hwnd);
  HWND overlay = EnsureShiftOverlay(owner);
  if (!overlay) return;
  if (visible) {
    SetPropW(overlay, kShiftOverlayVisibleProperty,
             reinterpret_cast<HANDLE>(static_cast<INT_PTR>(1)));
  } else {
    RemovePropW(overlay, kShiftOverlayVisibleProperty);
  }
  SyncShiftOverlay(overlay, owner);
}
}  // namespace
