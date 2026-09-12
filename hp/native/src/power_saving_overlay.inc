// Power-saving overlay HWND, geometry and painting.
namespace {
constexpr wchar_t kOverlayWindowClass[] = L"HomePanelPowerSavingOverlay";
constexpr size_t kControlButtonCount = 3;

RECT ShrinkRect(RECT rect, int inset) {
  rect.left += inset;
  rect.top += inset;
  rect.right -= inset;
  rect.bottom -= inset;
  if (rect.right <= rect.left) rect.right = rect.left + 1;
  if (rect.bottom <= rect.top) rect.bottom = rect.top + 1;
  return rect;
}

int ControlButtonGap(int extent) noexcept {
  return std::clamp(extent * 20 / 1000, 6, 12);
}

RECT ControlButtonRect(const RECT& row, size_t index) noexcept {
  const int width = std::max(1L, row.right - row.left);
  const int gap = ControlButtonGap(width);
  const int totalGap = gap * static_cast<int>(kControlButtonCount - 1);
  const int buttonWidth = std::max(
      1, (width - totalGap) / static_cast<int>(kControlButtonCount));
  const LONG left = std::min<LONG>(
      row.right,
      row.left + static_cast<LONG>(index) * (buttonWidth + gap));
  const LONG right = index + 1 >= kControlButtonCount
      ? row.right
      : std::min<LONG>(row.right, left + buttonWidth);
  return RECT{left, row.top, std::max<LONG>(left + 1, right), row.bottom};
}
}  // namespace

LRESULT CALLBACK PowerSavingController::OverlayWndProc(
    HWND window, UINT message, WPARAM wParam, LPARAM lParam) {
  auto* controller = reinterpret_cast<PowerSavingController*>(
      GetWindowLongPtrW(window, GWLP_USERDATA));
  if (message == WM_NCCREATE) {
    controller = static_cast<PowerSavingController*>(
        reinterpret_cast<CREATESTRUCTW*>(lParam)->lpCreateParams);
    SetWindowLongPtrW(
        window, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(controller));
  }
  if (!controller) return DefWindowProcW(window, message, wParam, lParam);

  switch (message) {
    case WM_TIMER:
      if (wParam == kScheduleTimer) {
        controller->CheckSchedule();
        return 0;
      }
      if (wParam == kMvStartupPassTimer) {
        controller->CloseMvStartupInputPass();
        return 0;
      }
      break;
    case WM_LBUTTONUP: {
      const POINT point{GET_X_LPARAM(lParam), GET_Y_LPARAM(lParam)};
      const RECT updateButton = controller->LocalUpdateButtonRect();
      const RECT powerButton = controller->LocalPowerButtonRect();
      const RECT muteButton = controller->LocalMuteButtonRect();
      if (PtInRect(&updateButton, point)) {
        if (controller->parent_ && IsWindow(controller->parent_)) {
          PostMessageW(
              controller->parent_, kRendererActionMessage,
              static_cast<WPARAM>(UiAction::AppUpdate), 0);
        }
      } else if (PtInRect(&powerButton, point)) {
        controller->ApplyMode(!controller->powerSaving_);
      } else if (PtInRect(&muteButton, point)) {
        controller->ApplyMediaMute(!controller->mediaMuted_);
      }
      return 0;
    }
    case WM_SETCURSOR:
      SetCursor(LoadCursorW(nullptr, IDC_HAND));
      return TRUE;
    case WM_ERASEBKGND:
      return 1;
    case WM_PAINT:
      controller->PaintOverlay(window);
      return 0;
    case kRaiseOverlayMessage:
      controller->LayoutOverlay();
      return 0;
    case WM_NCDESTROY:
      KillTimer(window, kScheduleTimer);
      KillTimer(window, kMvStartupPassTimer);
      if (controller->overlay_ == window) controller->overlay_ = nullptr;
      SetWindowLongPtrW(window, GWLP_USERDATA, 0);
      break;
  }
  return DefWindowProcW(window, message, wParam, lParam);
}

void PowerSavingController::EnsureOverlay() {
  if (!parent_ || (overlay_ && IsWindow(overlay_))) return;

  static std::once_flag classOnce;
  std::call_once(classOnce, [] {
    WNDCLASSW windowClass{};
    windowClass.lpfnWndProc = OverlayWndProc;
    windowClass.hInstance = GetModuleHandleW(nullptr);
    windowClass.hCursor = LoadCursorW(nullptr, IDC_HAND);
    windowClass.hbrBackground =
        reinterpret_cast<HBRUSH>(GetStockObject(BLACK_BRUSH));
    windowClass.lpszClassName = kOverlayWindowClass;
    SetLastError(ERROR_SUCCESS);
    if (!RegisterClassW(&windowClass) &&
        GetLastError() != ERROR_CLASS_ALREADY_EXISTS) {
      ThrowIfFailed(
          HRESULT_FROM_WIN32(GetLastError()),
          "RegisterClass power saving overlay");
    }
  });

  overlay_ = CreateWindowExW(
      WS_EX_NOPARENTNOTIFY,
      kOverlayWindowClass,
      L"更新 / 省電力 / ミュート",
      WS_CHILD | WS_VISIBLE | WS_CLIPSIBLINGS,
      0,
      0,
      1,
      1,
      parent_,
      nullptr,
      GetModuleHandleW(nullptr),
      this);
  if (!overlay_) {
    ThrowIfFailed(
        HRESULT_FROM_WIN32(GetLastError()),
        "CreateWindow power saving overlay");
  }
}

void PowerSavingController::LayoutOverlay() {
  if (!parent_ || !overlay_ || !IsWindow(parent_) || !IsWindow(overlay_)) return;
  RECT target{};
  GetClientRect(parent_, &target);
  const bool compact = !powerSaving_ || mvStartupInputPass_;
  if (compact) target = ParentControlStackRect();
  const int width = std::max(1L, target.right - target.left);
  const int height = std::max(1L, target.bottom - target.top);
  SetWindowPos(
      overlay_, HWND_TOP,
      target.left, target.top,
      width, height,
      SWP_NOACTIVATE | SWP_SHOWWINDOW | SWP_NOSENDCHANGING);
  if (compact) {
    const int corner = std::max(8, std::min(20, height / 3));
    HRGN region = CreateRoundRectRgn(
        0, 0, width + 1, height + 1, corner, corner);
    if (region && SetWindowRgn(overlay_, region, TRUE) == 0) {
      DeleteObject(region);
    }
  } else {
    SetWindowRgn(overlay_, nullptr, TRUE);
  }
  InvalidateRect(overlay_, nullptr, FALSE);
}

RECT PowerSavingController::ParentControlStackRect() const {
  RECT client{0, 0, 1, 1};
  if (!parent_ || !GetClientRect(parent_, &client)) return client;

  const NativeDashboardLayout layout = ComputeNativeDashboardLayout(client);
  const RECT side = layout.side;
  const int sideWidth = std::max(1L, side.right - side.left);
  const int sideHeight = std::max(1L, side.bottom - side.top);
  const int gap = std::max(6, sideHeight * 18 / 1000);
  const int upperMediaHeight = sideHeight * 600 / 1000;
  const int weatherHeight = std::max(1, sideHeight - upperMediaHeight - gap);
  const int compactAvailable =
      std::max(2, sideHeight - weatherHeight - gap * 2);
  const int clockHeight = std::max(1, compactAvailable * 55 / 100);
  const RECT clock{side.left, side.top, side.right, side.top + clockHeight};
  const int pad = std::clamp(
      std::min(sideWidth, clockHeight) * 10 / 100, 8, 26);
  const RECT content = ShrinkRect(clock, pad);
  const int contentWidth = std::max(1L, content.right - content.left);
  const int contentHeight = std::max(1L, content.bottom - content.top);
  const LONG statusTop = content.top + contentHeight * 790 / 1000;
  const RECT status{content.left, statusTop, content.right, content.bottom};
  const int statusHeight = std::max(1L, status.bottom - status.top);
  const int buttonGap = ControlButtonGap(contentWidth);
  const int buttonWidth = std::clamp(contentWidth * 205 / 1000, 74, 110);
  const int buttonHeight = std::min(
      statusHeight,
      std::clamp(statusHeight * 70 / 100, 28, 34));
  const int rowWidth = buttonWidth * 3 + buttonGap * 2;
  const LONG top =
      status.top + std::max(0, (statusHeight - buttonHeight) / 2);
  return RECT{
      status.right - rowWidth,
      top,
      status.right,
      top + buttonHeight};
}

RECT PowerSavingController::LocalUpdateButtonRect() const {
  if (!overlay_) return RECT{0, 0, 1, 1};
  RECT row{};
  if (powerSaving_ && !mvStartupInputPass_) {
    row = ParentControlStackRect();
  } else {
    GetClientRect(overlay_, &row);
  }
  return ControlButtonRect(row, 0);
}

RECT PowerSavingController::LocalPowerButtonRect() const {
  if (!overlay_) return RECT{0, 0, 1, 1};
  RECT row{};
  if (powerSaving_ && !mvStartupInputPass_) {
    row = ParentControlStackRect();
  } else {
    GetClientRect(overlay_, &row);
  }
  return ControlButtonRect(row, 1);
}

RECT PowerSavingController::LocalMuteButtonRect() const {
  if (!overlay_) return RECT{0, 0, 1, 1};
  RECT row{};
  if (powerSaving_ && !mvStartupInputPass_) {
    row = ParentControlStackRect();
  } else {
    GetClientRect(overlay_, &row);
  }
  return ControlButtonRect(row, 2);
}

void PowerSavingController::PaintOverlay(HWND window) {
  PAINTSTRUCT paint{};
  HDC dc = BeginPaint(window, &paint);
  if (!dc) return;

  RECT client{};
  GetClientRect(window, &client);
  FillRect(
      dc, &client,
      reinterpret_cast<HBRUSH>(GetStockObject(BLACK_BRUSH)));

  const RECT updateButton = LocalUpdateButtonRect();
  const RECT powerButton = LocalPowerButtonRect();
  const RECT muteButton = LocalMuteButtonRect();
  auto drawButton = [&](const RECT& button, bool active,
                        COLORREF activeSurface, COLORREF activeBorder,
                        const wchar_t* text) {
    const COLORREF surface = active ? activeSurface : RGB(28, 36, 48);
    HBRUSH brush = CreateSolidBrush(surface);
    HPEN pen = CreatePen(
        PS_SOLID, 1, active ? activeBorder : RGB(63, 76, 96));
    HGDIOBJ previousBrush = SelectObject(dc, brush);
    HGDIOBJ previousPen = SelectObject(dc, pen);
    const int radius = std::max(8L, button.bottom - button.top);
    RoundRect(
        dc, button.left, button.top, button.right, button.bottom,
        radius, radius);
    SelectObject(dc, previousPen);
    SelectObject(dc, previousBrush);
    DeleteObject(pen);
    DeleteObject(brush);

    const int fontHeight = std::clamp(
        static_cast<int>((button.bottom - button.top) * 42 / 100), 11, 17);
    HFONT font = CreateFontW(
        -fontHeight, 0, 0, 0, FW_MEDIUM, FALSE, FALSE, FALSE,
        DEFAULT_CHARSET, OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS,
        CLEARTYPE_QUALITY, DEFAULT_PITCH | FF_DONTCARE, L"Yu Gothic UI");
    HGDIOBJ previousFont = SelectObject(dc, font);
    SetBkMode(dc, TRANSPARENT);
    SetTextColor(dc, RGB(232, 237, 244));
    RECT textRect = button;
    DrawTextW(
        dc, text, -1, &textRect,
        DT_CENTER | DT_VCENTER | DT_SINGLELINE | DT_NOPREFIX);
    SelectObject(dc, previousFont);
    DeleteObject(font);
  };

  drawButton(
      updateButton, false, RGB(40, 73, 112), RGB(84, 145, 211), L"更新");
  drawButton(
      powerButton, powerSaving_, RGB(30, 92, 55), RGB(74, 180, 105),
      powerSaving_ ? L"省電力 ON" : L"省電力");
  drawButton(
      muteButton, mediaMuted_, RGB(88, 43, 47), RGB(190, 92, 102),
      mediaMuted_ ? L"ミュート ON" : L"ミュート");

  EndPaint(window, &paint);
}
