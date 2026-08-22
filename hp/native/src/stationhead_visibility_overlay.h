#pragma once

#include "common.h"
#include "stationhead_manual_visibility.h"
#include "web_renderer.h"

namespace hp {

class StationheadVisibilityOverlay {
 public:
  StationheadVisibilityOverlay() = default;
  ~StationheadVisibilityOverlay() { Uninstall(); }

  StationheadVisibilityOverlay(const StationheadVisibilityOverlay&) = delete;
  StationheadVisibilityOverlay& operator=(const StationheadVisibilityOverlay&) = delete;

  void InstallForCurrentThread() {
    if (hook_) return;
    if (current_ && current_ != this) {
      throw std::runtime_error("Stationhead visibility overlay is already installed");
    }
    current_ = this;
    hook_ = SetWindowsHookExW(
        WH_CALLWNDPROC, CallWndProc, nullptr, GetCurrentThreadId());
    if (!hook_) {
      current_ = nullptr;
      ThrowIfFailed(
          HRESULT_FROM_WIN32(GetLastError()),
          "SetWindowsHookEx Stationhead visibility overlay");
    }
  }

  void Uninstall() noexcept {
    ClearStationheadManualForeground();
    if (overlay_ && IsWindow(overlay_)) DestroyWindow(overlay_);
    overlay_ = nullptr;
    parent_ = nullptr;
    if (hook_) {
      UnhookWindowsHookEx(hook_);
      hook_ = nullptr;
    }
    if (current_ == this) current_ = nullptr;
  }

 private:
  static constexpr UINT kRaiseOverlayMessage = WM_APP + 3;
  static constexpr wchar_t kMainWindowClass[] = L"HomePanelNativeWindow";
  static constexpr wchar_t kOverlayWindowClass[] =
      L"HomePanelStationheadVisibilityOverlay";

  static bool IsMainWindow(HWND window) noexcept {
    wchar_t className[64]{};
    return window && GetClassNameW(window, className, _countof(className)) > 0 &&
        wcscmp(className, kMainWindowClass) == 0;
  }

  static LRESULT CALLBACK CallWndProc(int code, WPARAM wParam, LPARAM lParam) {
    StationheadVisibilityOverlay* overlay = current_;
    if (code >= 0 && overlay && lParam) {
      overlay->ObserveMessage(*reinterpret_cast<const CWPSTRUCT*>(lParam));
    }
    return CallNextHookEx(
        overlay ? overlay->hook_ : nullptr, code, wParam, lParam);
  }

  static LRESULT CALLBACK OverlayWndProc(
      HWND window, UINT message, WPARAM wParam, LPARAM lParam) {
    auto* overlay = reinterpret_cast<StationheadVisibilityOverlay*>(
        GetWindowLongPtrW(window, GWLP_USERDATA));
    if (message == WM_NCCREATE) {
      overlay = static_cast<StationheadVisibilityOverlay*>(
          reinterpret_cast<CREATESTRUCTW*>(lParam)->lpCreateParams);
      SetWindowLongPtrW(
          window, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(overlay));
    }
    if (!overlay) return DefWindowProcW(window, message, wParam, lParam);

    switch (message) {
      case WM_LBUTTONUP:
        ToggleStationheadManualForeground();
        overlay->RequestParentLayout();
        overlay->LayoutOverlay();
        return 0;
      case WM_SETCURSOR:
        SetCursor(LoadCursorW(nullptr, IDC_HAND));
        return TRUE;
      case WM_ERASEBKGND:
        return 1;
      case WM_PAINT:
        overlay->PaintOverlay(window);
        return 0;
      case kRaiseOverlayMessage:
        overlay->LayoutOverlay();
        return 0;
      case WM_NCDESTROY:
        if (overlay->overlay_ == window) overlay->overlay_ = nullptr;
        SetWindowLongPtrW(window, GWLP_USERDATA, 0);
        break;
    }
    return DefWindowProcW(window, message, wParam, lParam);
  }

  void ObserveMessage(const CWPSTRUCT& message) {
    if (!parent_ && message.message == WM_CREATE && IsMainWindow(message.hwnd)) {
      Attach(message.hwnd);
      return;
    }
    if (!parent_) return;

    if (message.hwnd == parent_) {
      switch (message.message) {
        case WM_DISPLAYCHANGE:
        case WM_SIZE:
        case WM_WINDOWPOSCHANGED:
        case WM_SHOWWINDOW:
        case WM_TIMER:
          RequestOverlayRaise();
          break;
        case WM_NCDESTROY:
          if (overlay_ && IsWindow(overlay_)) DestroyWindow(overlay_);
          overlay_ = nullptr;
          parent_ = nullptr;
          return;
      }
    }

    if (overlay_ && message.hwnd != overlay_ && IsChild(parent_, message.hwnd) &&
        (message.message == WM_CREATE || message.message == WM_SHOWWINDOW ||
         message.message == WM_WINDOWPOSCHANGED)) {
      RequestOverlayRaise();
    }
  }

  void Attach(HWND parent) {
    if (!parent || parent_ == parent) return;
    if (overlay_ && IsWindow(overlay_)) DestroyWindow(overlay_);
    overlay_ = nullptr;
    parent_ = parent;
    EnsureOverlay();
    LayoutOverlay();
  }

  void EnsureOverlay() {
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
            "RegisterClass Stationhead visibility overlay");
      }
    });

    overlay_ = CreateWindowExW(
        WS_EX_NOPARENTNOTIFY,
        kOverlayWindowClass,
        L"Stationhead 前面化/背面化",
        WS_CHILD | WS_VISIBLE | WS_CLIPSIBLINGS,
        0, 0, 1, 1,
        parent_, nullptr, GetModuleHandleW(nullptr), this);
    if (!overlay_) {
      ThrowIfFailed(
          HRESULT_FROM_WIN32(GetLastError()),
          "CreateWindow Stationhead visibility overlay");
    }
  }

  void RequestOverlayRaise() const noexcept {
    if (overlay_) PostMessageW(overlay_, kRaiseOverlayMessage, 0, 0);
  }

  void RequestParentLayout() const noexcept {
    if (!parent_ || !IsWindow(parent_)) return;
    RECT client{};
    if (!GetClientRect(parent_, &client)) return;
    const int width = std::max(1L, client.right - client.left);
    const int height = std::max(1L, client.bottom - client.top);
    SendMessageW(
        parent_, WM_SIZE, SIZE_RESTORED,
        MAKELPARAM(
            static_cast<WORD>(std::min(width, 65535)),
            static_cast<WORD>(std::min(height, 65535))));
  }

  RECT ParentButtonRect() const noexcept {
    RECT client{0, 0, 1, 1};
    if (!parent_ || !GetClientRect(parent_, &client)) return client;

    const NativeDashboardLayout layout = ComputeNativeDashboardLayout(client);
    const RECT main = layout.main;
    const int width = std::max(1L, main.right - main.left);
    const int height = std::max(1L, main.bottom - main.top);
    const int gapY = std::max(6, height * 45 / 1000);
    const int newsHeight = height * 270 / 1000;
    const LONG rowBottom =
        std::max(main.top + 1, main.bottom - newsHeight - gapY);
    RECT music{main.left, main.top, main.left + width * 480 / 1000, rowBottom};
    if (music.right <= music.left) music.right = music.left + 1;
    if (music.bottom <= music.top) music.bottom = music.top + 1;

    const int cardWidth = std::max(1L, music.right - music.left);
    const int cardHeight = std::max(1L, music.bottom - music.top);
    const int cardPad = std::clamp(
        std::min(cardWidth, cardHeight) * 10 / 100, 8, 26);
    RECT content{
        music.left + cardPad, music.top + cardPad,
        music.right - cardPad, music.bottom - cardPad};
    if (content.right <= content.left) content.right = content.left + 1;
    if (content.bottom <= content.top) content.bottom = content.top + 1;

    const int contentHeight = std::max(1L, content.bottom - content.top);
    const int headerHeight = std::clamp(contentHeight * 140 / 1000, 16, 34);
    RECT body = content;
    body.top += headerHeight + std::max(4, contentHeight * 40 / 1000);
    if (body.bottom <= body.top) body.bottom = body.top + 1;

    const int rowHeight = std::max(1L, body.bottom - body.top);
    const int buttonGap = std::max(3, rowHeight * 4 / 100);
    const int buttonHeight = std::min(
        std::clamp(rowHeight * 28 / 100, 20, 44),
        std::max(1, (rowHeight - buttonGap) / 2));
    const int buttonWidth = std::clamp(
        static_cast<int>((body.right - body.left) * 170 / 1000), 64, 140);
    const int footerHeight = std::clamp(rowHeight * 14 / 100, 16, 30);
    const int clusterHeight =
        buttonHeight * 2 + footerHeight + buttonGap * 2;
    const LONG clusterTop =
        body.top + std::max(0, (rowHeight - clusterHeight) / 2);
    const LONG muteBottom = clusterTop + buttonHeight * 2 + buttonGap;
    const LONG top = muteBottom + buttonGap;
    return RECT{body.right - buttonWidth, top, body.right, top + footerHeight};
  }

  void LayoutOverlay() {
    if (!parent_ || !overlay_ || !IsWindow(parent_) || !IsWindow(overlay_)) return;
    const RECT target = ParentButtonRect();
    SetWindowPos(
        overlay_, HWND_TOP,
        target.left, target.top,
        std::max(1L, target.right - target.left),
        std::max(1L, target.bottom - target.top),
        SWP_NOACTIVATE | SWP_SHOWWINDOW | SWP_NOSENDCHANGING);
    InvalidateRect(overlay_, nullptr, FALSE);
  }

  void PaintOverlay(HWND window) const noexcept {
    PAINTSTRUCT paint{};
    HDC dc = BeginPaint(window, &paint);
    if (!dc) return;

    RECT button{};
    GetClientRect(window, &button);
    FillRect(
        dc, &button,
        reinterpret_cast<HBRUSH>(GetStockObject(BLACK_BRUSH)));

    const bool foreground = StationheadManualForegroundEnabled();
    const COLORREF surface =
        foreground ? RGB(26, 52, 38) : RGB(31, 39, 52);
    const COLORREF outline =
        foreground ? RGB(74, 180, 105) : RGB(74, 88, 108);
    HBRUSH brush = CreateSolidBrush(surface);
    HPEN pen = CreatePen(PS_SOLID, 1, outline);
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
        static_cast<int>((button.bottom - button.top) * 54 / 100), 11, 18);
    HFONT font = CreateFontW(
        -fontHeight, 0, 0, 0, FW_SEMIBOLD, FALSE, FALSE, FALSE,
        DEFAULT_CHARSET, OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS,
        CLEARTYPE_QUALITY, DEFAULT_PITCH | FF_DONTCARE, L"Yu Gothic UI");
    HGDIOBJ previousFont = SelectObject(dc, font);
    SetBkMode(dc, TRANSPARENT);
    SetTextColor(dc, RGB(238, 242, 248));
    RECT textRect = button;
    DrawTextW(
        dc, foreground ? L"背面化" : L"前面化", -1, &textRect,
        DT_CENTER | DT_VCENTER | DT_SINGLELINE | DT_NOPREFIX);
    SelectObject(dc, previousFont);
    DeleteObject(font);

    EndPaint(window, &paint);
  }

  HHOOK hook_ = nullptr;
  HWND parent_ = nullptr;
  HWND overlay_ = nullptr;
  inline static thread_local StationheadVisibilityOverlay* current_ = nullptr;
};

}  // namespace hp
