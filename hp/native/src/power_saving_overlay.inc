// Power-saving overlay HWND, geometry and painting.
namespace {
constexpr wchar_t kOverlayWindowClass[] = L"HomePanelPowerSavingOverlay";
constexpr size_t kControlButtonCount = 3;
constexpr COLORREF kControlOverlayBackground = RGB(20, 26, 36);

HBRUSH ControlOverlayBackgroundBrush() noexcept {
  static HBRUSH brush = CreateSolidBrush(kControlOverlayBackground);
  return brush;
}

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
        controller->CycleMonitorMode();
      } else if (PtInRect(&muteButton, point)) {
        controller->CycleAudioMode();
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
      controller->ApplyStationheadMonitorPlacement();
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
    windowClass.hbrBackground = ControlOverlayBackgroundBrush();
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
      L"更新 / モニター / 音声出力",
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
  const bool boundsMatch = ChildBoundsMatch(overlay_, target);
  const bool zOrderMatch = GetWindow(overlay_, GW_HWNDPREV) == nullptr;
  const bool visible = IsWindowVisible(overlay_) != FALSE;

  if (!boundsMatch || !zOrderMatch || !visible) {
    UINT flags = SWP_NOACTIVATE | SWP_SHOWWINDOW | SWP_NOSENDCHANGING;
    if (boundsMatch) flags |= SWP_NOMOVE | SWP_NOSIZE;
    SetWindowPos(
        overlay_, HWND_TOP,
        target.left, target.top,
        width, height,
        flags);
  }
  if (!boundsMatch) {
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
}

RECT PowerSavingController::ParentControlStackRect() const {
  RECT client{0, 0, 1, 1};
  if (!parent_ || !GetClientRect(parent_, &client)) return client;

  const NativeDashboardLayout layout = ComputeNativeDashboardLayout(client);
  const RECT side = layout.side;
  const int sideWidth = std::max(1L, side.right - side.left);
  const int sideHeight = std::max(1L, side.bottom - side.top);
  const int gap = std::max(6, sideHeight * 18 / 1000);

  const int upperMediaHeight = sideHeight * 480 / 1000;
  const int weatherHeight = std::max(1, sideHeight - upperMediaHeight - gap);
  const int compactAvailable =
      std::max(2, sideHeight - weatherHeight - gap * 2);
  const int legacyClockHeight =
      std::max(1, compactAvailable * 55 / 100);
  const int sidebarClockHeight =
      std::max(1, (sideHeight - gap * 2) / 3);
  const int clockHeight = std::max(sidebarClockHeight, legacyClockHeight);
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
  const int width = std::max(1L, client.right - client.left);
  const int height = std::max(1L, client.bottom - client.top);
  HDC memoryDc = CreateCompatibleDC(dc);
  HBITMAP bitmap = memoryDc ? CreateCompatibleBitmap(dc, width, height) : nullptr;
  HGDIOBJ previousBitmap =
      memoryDc && bitmap ? SelectObject(memoryDc, bitmap) : nullptr;
  HDC paintDc = memoryDc && bitmap ? memoryDc : dc;

  FillRect(paintDc, &client, ControlOverlayBackgroundBrush());

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
    HGDIOBJ previousBrush = SelectObject(paintDc, brush);
    HGDIOBJ previousPen = SelectObject(paintDc, pen);
    const int radius = std::max(8L, button.bottom - button.top);
    RoundRect(
        paintDc, button.left, button.top, button.right, button.bottom,
        radius, radius);
    SelectObject(paintDc, previousPen);
    SelectObject(paintDc, previousBrush);
    DeleteObject(pen);
    DeleteObject(brush);

    int fontHeight = std::clamp(
        static_cast<int>((button.bottom - button.top) * 42 / 100), 11, 17);
    auto createButtonFont = [](int height) {
      return CreateFontW(
          -height, 0, 0, 0, FW_MEDIUM, FALSE, FALSE, FALSE,
          DEFAULT_CHARSET, OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS,
          CLEARTYPE_QUALITY, DEFAULT_PITCH | FF_DONTCARE, L"Yu Gothic UI");
    };
    HFONT font = createButtonFont(fontHeight);
    HGDIOBJ previousFont = SelectObject(paintDc, font);
    SIZE textSize{};
    const int availableTextWidth =
        std::max(1L, button.right - button.left - 8);
    if (GetTextExtentPoint32W(
            paintDc, text, static_cast<int>(wcslen(text)), &textSize) &&
        textSize.cx > availableTextWidth && fontHeight > 9) {
      SelectObject(paintDc, previousFont);
      DeleteObject(font);
      fontHeight = std::max(
          9, static_cast<int>(fontHeight * availableTextWidth / std::max(1L, textSize.cx)));
      font = createButtonFont(fontHeight);
      previousFont = SelectObject(paintDc, font);
    }
    SetBkMode(paintDc, TRANSPARENT);
    SetTextColor(paintDc, RGB(232, 237, 244));
    RECT textRect = button;
    DrawTextW(
        paintDc, text, -1, &textRect,
        DT_CENTER | DT_VCENTER | DT_SINGLELINE | DT_NOPREFIX);
    SelectObject(paintDc, previousFont);
    DeleteObject(font);
  };

  drawButton(
      updateButton, false, RGB(40, 73, 112), RGB(84, 145, 211), L"更新");

  const wchar_t* monitorLabel = L"モニターYT";
  if (monitorMode_ == MonitorMode::ServiceGrid) {
    switch (monitorStationheadProfile_) {
      case 1: monitorLabel = L"モニターtgut"; break;
      case 2: monitorLabel = L"モニターyuukiar"; break;
      case 3: monitorLabel = L"モニターten"; break;
      case 4: monitorLabel = L"モニターnagi"; break;
      case 5: monitorLabel = L"モニターhinata"; break;
      case 6: monitorLabel = L"モニターozeki"; break;
      default: monitorLabel = L"モニターOFF"; break;
    }
  } else if (monitorMode_ == MonitorMode::Off) {
    monitorLabel = L"モニターOFF";
  }
  drawButton(
      powerButton, monitorMode_ != MonitorMode::Native,
      RGB(30, 92, 55), RGB(74, 180, 105), monitorLabel);

  const wchar_t* audioModeLabel = L"音声出力YT";
  if (audioMode_ == AudioMode::Stationhead) {
    audioModeLabel = L"音声出力ozeki";
  } else if (audioMode_ == AudioMode::StationheadPeer1) {
    audioModeLabel = L"音声出力tgut";
  } else if (audioMode_ == AudioMode::StationheadPeer2) {
    audioModeLabel = L"音声出力yuukiar";
  } else if (audioMode_ == AudioMode::StationheadPeer3) {
    audioModeLabel = L"音声出力ten";
  } else if (audioMode_ == AudioMode::StationheadPeer4) {
    audioModeLabel = L"音声出力nagi";
  } else if (audioMode_ == AudioMode::StationheadPeer5) {
    audioModeLabel = L"音声出力hinata";
  } else if (audioMode_ == AudioMode::Muted) {
    audioModeLabel = L"音声出力OFF";
  }
  drawButton(
      muteButton, mediaMuted_, RGB(88, 43, 47), RGB(190, 92, 102),
      audioModeLabel);

  if (paintDc != dc) {
    BitBlt(dc, 0, 0, width, height, paintDc, 0, 0, SRCCOPY);
  }
  if (memoryDc && bitmap) {
    SelectObject(memoryDc, previousBitmap);
    DeleteObject(bitmap);
  }
  if (memoryDc) DeleteDC(memoryDc);
  EndPaint(window, &paint);
}