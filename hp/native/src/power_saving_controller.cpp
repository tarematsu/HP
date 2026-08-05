#include "power_saving_controller.h"
#include "web_renderer.h"
#include <winrt/Windows.Graphics.Display.h>

namespace hp {
namespace {
constexpr wchar_t kMainWindowClass[] = L"HomePanelNativeWindow";
constexpr wchar_t kOverlayWindowClass[] = L"HomePanelPowerSavingOverlay";
constexpr int kPowerSavingStartMinute = 12 * 60;
constexpr int kPowerSavingEndMinute = 20 * 60;

constexpr bool ScheduledPowerSavingAt(int hour, int minute) noexcept {
  const int minuteOfDay = hour * 60 + minute;
  return minuteOfDay >= kPowerSavingStartMinute &&
      minuteOfDay < kPowerSavingEndMinute;
}

static_assert(!ScheduledPowerSavingAt(11, 59));
static_assert(ScheduledPowerSavingAt(12, 0));
static_assert(ScheduledPowerSavingAt(19, 59));
static_assert(!ScheduledPowerSavingAt(20, 0));

bool IsMainWindow(HWND window) {
  wchar_t className[64]{};
  return window && GetClassNameW(window, className, _countof(className)) > 0 &&
      wcscmp(className, kMainWindowClass) == 0;
}

bool ScheduledPowerSavingNow(int64_t nowMs) {
  const std::time_t seconds = static_cast<std::time_t>(nowMs / 1000);
  std::tm local{};
  if (localtime_s(&local, &seconds) != 0) return false;
  return ScheduledPowerSavingAt(local.tm_hour, local.tm_min);
}

int64_t NextScheduleBoundary(int64_t nowMs) {
  const std::time_t seconds = static_cast<std::time_t>(nowMs / 1000);
  std::tm boundary{};
  if (localtime_s(&boundary, &seconds) != 0) return nowMs + 60'000;

  const int minuteOfDay = boundary.tm_hour * 60 + boundary.tm_min;
  boundary.tm_sec = 0;
  boundary.tm_min = 0;
  if (minuteOfDay < kPowerSavingStartMinute) {
    boundary.tm_hour = 12;
  } else if (minuteOfDay < kPowerSavingEndMinute) {
    boundary.tm_hour = 20;
  } else {
    boundary.tm_hour = 12;
    ++boundary.tm_mday;
  }

  const std::time_t next = std::mktime(&boundary);
  return next == static_cast<std::time_t>(-1)
      ? nowMs + 60'000
      : static_cast<int64_t>(next) * 1000;
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
}  // namespace

struct PowerSavingController::BrightnessState {
  winrt::Windows::Graphics::Display::BrightnessOverride controller{nullptr};
  bool active = false;
};

PowerSavingController::~PowerSavingController() { Uninstall(); }

void PowerSavingController::InstallForCurrentThread() {
  if (hook_) return;
  if (current_ && current_ != this) {
    throw std::runtime_error("power saving controller is already installed");
  }
  current_ = this;
  hook_ = SetWindowsHookExW(
      WH_CALLWNDPROC, CallWndProc, nullptr, GetCurrentThreadId());
  if (!hook_) {
    current_ = nullptr;
    ThrowIfFailed(
        HRESULT_FROM_WIN32(GetLastError()), "SetWindowsHookEx power saving");
  }
}

void PowerSavingController::Uninstall() noexcept {
  Detach();
  if (hook_) {
    UnhookWindowsHookEx(hook_);
    hook_ = nullptr;
  }
  if (current_ == this) current_ = nullptr;
}

LRESULT CALLBACK PowerSavingController::CallWndProc(
    int code, WPARAM wParam, LPARAM lParam) {
  PowerSavingController* controller = current_;
  if (code >= 0 && controller && lParam) {
    controller->ObserveMessage(*reinterpret_cast<const CWPSTRUCT*>(lParam));
  }
  return CallNextHookEx(
      controller ? controller->hook_ : nullptr, code, wParam, lParam);
}

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
      break;
    case WM_LBUTTONUP: {
      const POINT point{GET_X_LPARAM(lParam), GET_Y_LPARAM(lParam)};
      const RECT button = controller->LocalButtonRect();
      if (PtInRect(&button, point)) {
        controller->ApplyMode(!controller->powerSaving_);
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
      if (controller->overlay_ == window) controller->overlay_ = nullptr;
      SetWindowLongPtrW(window, GWLP_USERDATA, 0);
      break;
  }
  return DefWindowProcW(window, message, wParam, lParam);
}

void PowerSavingController::ObserveMessage(const CWPSTRUCT& message) {
  if (!parent_ && message.message == WM_CREATE && IsMainWindow(message.hwnd)) {
    Attach(message.hwnd);
    return;
  }
  if (!parent_) return;

  if (message.hwnd == parent_) {
    switch (message.message) {
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
        if (message.wParam == PBT_APMRESUMEAUTOMATIC ||
            message.wParam == PBT_APMRESUMESUSPEND) {
          CheckSchedule();
          if (powerSaving_) RefreshMinimumBrightness();
          LayoutOverlay();
        }
        break;
      case WM_NCDESTROY:
        Detach();
        return;
    }
  }

  if (overlay_ && message.hwnd != overlay_ && IsChild(parent_, message.hwnd) &&
      (message.message == WM_CREATE || message.message == WM_SHOWWINDOW ||
       message.message == WM_WINDOWPOSCHANGED)) {
    PostMessageW(overlay_, kRaiseOverlayMessage, 0, 0);
  }
}

void PowerSavingController::Attach(HWND parent) {
  if (!parent || parent_ == parent) return;
  Detach();
  parent_ = parent;
  EnsureOverlay();
  CheckSchedule(true);
  LayoutOverlay();
}

void PowerSavingController::Detach() noexcept {
  RestoreBrightness();
  if (overlay_ && IsWindow(overlay_)) {
    KillTimer(overlay_, kScheduleTimer);
    DestroyWindow(overlay_);
  }
  overlay_ = nullptr;
  parent_ = nullptr;
  scheduleInitialized_ = false;
  nextScheduleBoundaryAt_ = 0;
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
      L"省電力",
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

void PowerSavingController::CheckSchedule(bool force) {
  if (!overlay_) return;
  const int64_t now = UnixMillis();
  if (!scheduleInitialized_ || force || now >= nextScheduleBoundaryAt_) {
    scheduleInitialized_ = true;
    ApplyMode(ScheduledPowerSavingNow(now));
    nextScheduleBoundaryAt_ = NextScheduleBoundary(now);
  }
  ArmScheduleTimer();
}

void PowerSavingController::ArmScheduleTimer() {
  if (!overlay_) return;
  KillTimer(overlay_, kScheduleTimer);
  const int64_t remaining = std::max<int64_t>(
      1, nextScheduleBoundaryAt_ - UnixMillis());
  const UINT delay = static_cast<UINT>(std::clamp<int64_t>(
      remaining, 1, std::numeric_limits<UINT>::max()));
  SetTimer(overlay_, kScheduleTimer, delay, nullptr);
}

void PowerSavingController::ApplyMode(bool enabled) {
  const bool changed = powerSaving_ != enabled;
  powerSaving_ = enabled;
  if (enabled) {
    ApplyMinimumBrightness();
  } else {
    RestoreBrightness();
  }
  Renderer::SetGlobalPowerSavingMode(enabled);
  if (changed) LayoutOverlay();
  if (overlay_) InvalidateRect(overlay_, nullptr, FALSE);
}

void PowerSavingController::ApplyMinimumBrightness() noexcept {
  try {
    if (!brightnessState_) brightnessState_ = std::make_unique<BrightnessState>();
    if (brightnessState_->active) return;
    if (!brightnessState_->controller) {
      brightnessState_->controller =
          winrt::Windows::Graphics::Display::BrightnessOverride::GetDefaultForSystem();
    }
    if (!brightnessState_->controller) return;
    brightnessState_->controller.SetBrightnessLevel(
        0.0,
        winrt::Windows::Graphics::Display::DisplayBrightnessOverrideOptions::None);
    brightnessState_->controller.StartOverride();
    brightnessState_->active = true;
  } catch (...) {
    try {
      if (brightnessState_ && brightnessState_->controller) {
        brightnessState_->controller.StopOverride();
      }
    } catch (...) {
    }
    brightnessState_.reset();
  }
}

void PowerSavingController::RestoreBrightness() noexcept {
  auto state = std::move(brightnessState_);
  if (!state || !state->active || !state->controller) return;
  try {
    state->controller.StopOverride();
  } catch (...) {
  }
}

void PowerSavingController::RefreshMinimumBrightness() noexcept {
  if (!powerSaving_) return;
  RestoreBrightness();
  ApplyMinimumBrightness();
}

void PowerSavingController::LayoutOverlay() {
  if (!parent_ || !overlay_ || !IsWindow(parent_) || !IsWindow(overlay_)) return;
  RECT target{};
  GetClientRect(parent_, &target);
  if (!powerSaving_) target = ParentButtonRect();
  SetWindowPos(
      overlay_, HWND_TOP,
      target.left, target.top,
      std::max(1L, target.right - target.left),
      std::max(1L, target.bottom - target.top),
      SWP_NOACTIVATE | SWP_SHOWWINDOW | SWP_NOSENDCHANGING);
  InvalidateRect(overlay_, nullptr, FALSE);
}

RECT PowerSavingController::ParentButtonRect() const {
  RECT client{0, 0, 1, 1};
  if (!parent_ || !GetClientRect(parent_, &client)) return client;

  const NativeDashboardLayout layout = ComputeNativeDashboardLayout(client);
  const RECT side = layout.side;
  const int sideWidth = std::max(1L, side.right - side.left);
  const int sideHeight = std::max(1L, side.bottom - side.top);
  const int gap = std::max(6, sideHeight * 18 / 1000);
  const int available = std::max(3, sideHeight - gap * 2);
  const int clockHeight = std::max(1, available * 27 / 100);
  const RECT clock{side.left, side.top, side.right, side.top + clockHeight};
  const int pad = std::clamp(
      std::min(sideWidth, clockHeight) * 10 / 100, 8, 26);
  const RECT content = ShrinkRect(clock, pad);
  const int contentWidth = std::max(1L, content.right - content.left);
  const int contentHeight = std::max(1L, content.bottom - content.top);
  const LONG statusTop = content.top + contentHeight * 735 / 1000;
  const RECT status{content.left, statusTop, content.right, content.bottom};
  const int statusHeight = std::max(1L, status.bottom - status.top);
  const int buttonWidth = std::clamp(contentWidth * 300 / 1000, 86, 150);
  const int buttonHeight = std::clamp(statusHeight * 70 / 100, 26, 42);
  const LONG top =
      status.top + std::max(0, (statusHeight - buttonHeight) / 2);
  return RECT{
      status.right - buttonWidth,
      top,
      status.right,
      top + buttonHeight};
}

RECT PowerSavingController::LocalButtonRect() const {
  if (!overlay_) return RECT{0, 0, 1, 1};
  if (powerSaving_) return ParentButtonRect();
  RECT client{};
  GetClientRect(overlay_, &client);
  return client;
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

  const RECT button = LocalButtonRect();
  const COLORREF surface =
      powerSaving_ ? RGB(30, 92, 55) : RGB(31, 39, 52);
  HBRUSH brush = CreateSolidBrush(surface);
  HPEN pen = CreatePen(
      PS_SOLID, 1,
      powerSaving_ ? RGB(74, 180, 105) : RGB(74, 88, 108));
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
      static_cast<int>((button.bottom - button.top) * 42 / 100), 12, 20);
  HFONT font = CreateFontW(
      -fontHeight, 0, 0, 0, FW_SEMIBOLD, FALSE, FALSE, FALSE,
      DEFAULT_CHARSET, OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS,
      CLEARTYPE_QUALITY, DEFAULT_PITCH | FF_DONTCARE, L"Yu Gothic UI");
  HGDIOBJ previousFont = SelectObject(dc, font);
  SetBkMode(dc, TRANSPARENT);
  SetTextColor(dc, RGB(238, 242, 248));
  RECT textRect = button;
  DrawTextW(
      dc, powerSaving_ ? L"省電力 ON" : L"省電力", -1, &textRect,
      DT_CENTER | DT_VCENTER | DT_SINGLELINE | DT_NOPREFIX);
  SelectObject(dc, previousFont);
  DeleteObject(font);

  EndPaint(window, &paint);
}

}  // namespace hp
