// Kept as one translation unit so cached GDI primitives remain shared.
// Fragment boundaries follow complete responsibilities and never split functions.
#include "native_media_audio.h"
#include "network_request_coordinator.h"
#include "shared_webview_environment.h"
#include "spotify_webviews.h"
#include "version.h"
#include "webview_startup_cache_reset.h"
#include "webview_feature_policy.h"
#include "winhttp_helpers.h"
#include "renderer_panels/primitives.inc"

namespace {
void StretchRadarIntoLowPeak(
    HDC destDc, const RECT& destRect, HBITMAP radarBitmap) noexcept {
  const int destWidth = static_cast<int>(destRect.right - destRect.left);
  const int destHeight = static_cast<int>(destRect.bottom - destRect.top);
  if (!radarBitmap || destWidth <= 0 || destHeight <= 0) return;

  const double scale = std::max(
      static_cast<double>(destWidth) / kRadarCanvasWidth,
      static_cast<double>(destHeight) / kRadarCanvasHeight);
  const int sourceWidth = std::clamp(
      static_cast<int>(std::lround(destWidth / scale)), 1, kRadarCanvasWidth);
  const int sourceHeight = std::clamp(
      static_cast<int>(std::lround(destHeight / scale)), 1, kRadarCanvasHeight);
  const int sourceLeft = (kRadarCanvasWidth - sourceWidth) / 2;
  const int sourceTop = (kRadarCanvasHeight - sourceHeight) / 2;

  // Reuse the existing thread-local source DC instead of allocating/deleting a
  // compatible DC on every WM_PAINT. COLORONCOLOR avoids HALFTONE's expensive
  // per-pixel filtering; radar pixels are already composited at 1920x1280.
  HDC sourceDc = SourceMemoryDc(destDc);
  if (!sourceDc) return;
  HGDIOBJ previous = SelectObject(sourceDc, radarBitmap);
  if (!previous || previous == HGDI_ERROR) return;
  SetStretchBltMode(destDc, COLORONCOLOR);
  if (sourceWidth == destWidth && sourceHeight == destHeight) {
    BitBlt(destDc, destRect.left, destRect.top, destWidth, destHeight,
           sourceDc, sourceLeft, sourceTop, SRCCOPY);
  } else {
    StretchBlt(destDc, destRect.left, destRect.top, destWidth, destHeight,
               sourceDc, sourceLeft, sourceTop, sourceWidth, sourceHeight,
               SRCCOPY);
  }
  SelectObject(sourceDc, previous);
}
}  // namespace

// The large radar bitmap is painted only by the lower main-row radar section.
#define StretchRadarInto StretchRadarIntoLowPeak

#include "renderer_panels/layout_overrides.inc"
#include "renderer_panels/waste_calendar_section.inc"

namespace {
MainSections SplitWeatherRadarMatchedMainSections(
    const RECT& client, const RECT& dashboardBounds) {
  const NativeDashboardLayout dashboard =
      ComputeNativeDashboardLayout(dashboardBounds);
  const LONG sideWidth =
      std::max<LONG>(1, dashboard.side.right - dashboard.side.left);
  const LONG sideHeight =
      std::max<LONG>(1, dashboard.side.bottom - dashboard.side.top);
  const LONG sideGap = std::max<LONG>(6, sideHeight * 18 / 1000);
  const LONG rowHeight = std::max<LONG>(1, (sideHeight - sideGap * 2) / 3);

  const LONG width = std::max<LONG>(1, client.right - client.left);
  const LONG gapX = std::max<LONG>(8, width * 16 / 1000);
  const LONG maxWeatherWidth = std::max<LONG>(1, width - gapX - 1);
  const LONG weatherWidth = std::clamp<LONG>(
      sideWidth, 1L, maxWeatherWidth);
  const LONG bottom = std::min<LONG>(client.bottom, client.top + rowHeight);

  MainSections sections;
  // windows.inc paints Weather through the historical radar slot and Rain Radar
  // through the historical energy slot. Give Weather exactly the same pixel
  // width and row height as Clock/Air/Electricity.
  sections.radar = RECT{
      client.left, client.top, client.left + weatherWidth, bottom};
  sections.energy = RECT{
      sections.radar.right + gapX, client.top, client.right, bottom};
  return sections;
}
}  // namespace

#define SplitSidebarSections SplitRearrangedSidebarSections
#define SplitMainSections(client) \
  SplitWeatherRadarMatchedMainSections((client), bounds_)
#define ClockTimeRectFromCard RearrangedClockTimeRectFromCard
#define DrawClockSection HP_DRAW_CLOCK_WITH_STATUS
#define DrawControlsSection DrawAirSection
#include "renderer_panels/windows.inc"
#undef DrawControlsSection
#undef DrawClockSection
#undef ClockTimeRectFromCard
#undef SplitMainSections
#undef SplitSidebarSections

#include "renderer_panels/environment_sections.inc"

namespace {
bool gNativeMediaMuted = false;

constexpr wchar_t kNativeMediaRootWindowClass[] = L"HomePanelNativeWindow";
constexpr wchar_t kNativeMediaOfflineOverlayClass[] =
    L"HomePanelNativeMediaOfflineOverlay";

HWND FindNativeMediaRootWindow() noexcept {
  struct Context {
    HWND found = nullptr;
  } context;
  EnumThreadWindows(
      GetCurrentThreadId(),
      [](HWND window, LPARAM rawContext) -> BOOL {
        auto* context = reinterpret_cast<Context*>(rawContext);
        if (!context) return FALSE;
        wchar_t className[64]{};
        if (GetClassNameW(window, className, _countof(className)) > 0 &&
            wcscmp(className, kNativeMediaRootWindowClass) == 0) {
          context->found = window;
          return FALSE;
        }
        return TRUE;
      },
      reinterpret_cast<LPARAM>(&context));
  return context.found;
}

LRESULT CALLBACK NativeMediaOfflineOverlayWindowProc(
    HWND window, UINT message, WPARAM wParam, LPARAM lParam) noexcept {
  if (message == WM_NCHITTEST) return HTTRANSPARENT;
  if (message == WM_ERASEBKGND) return 1;
  if (message == WM_PAINT) {
    PAINTSTRUCT paint{};
    HDC dc = BeginPaint(window, &paint);
    if (!dc) return 0;
    RECT client{};
    GetClientRect(window, &client);
    FillRect(dc, &client, static_cast<HBRUSH>(GetStockObject(BLACK_BRUSH)));
    SetBkMode(dc, TRANSPARENT);
    SetTextColor(dc, RGB(245, 245, 245));
    const int height = std::max(1L, client.bottom - client.top);
    const int fontHeight = std::clamp(height / 9, 28, 52);
    HFONT font = CreateFontW(
        -fontHeight, 0, 0, 0, FW_BOLD, FALSE, FALSE, FALSE, DEFAULT_CHARSET,
        OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS, CLEARTYPE_QUALITY,
        DEFAULT_PITCH | FF_DONTCARE, L"Yu Gothic UI");
    HGDIOBJ previous = font ? SelectObject(dc, font) : nullptr;
    DrawTextW(dc, L"インターネット接続がありません", -1, &client,
              DT_CENTER | DT_SINGLELINE | DT_VCENTER | DT_NOPREFIX);
    if (previous) SelectObject(dc, previous);
    if (font) DeleteObject(font);
    EndPaint(window, &paint);
    return 0;
  }
  return DefWindowProcW(window, message, wParam, lParam);
}

bool EnsureNativeMediaOfflineOverlayClass() noexcept {
  static const bool registered = []() noexcept {
    WNDCLASSW wc{};
    wc.lpfnWndProc = NativeMediaOfflineOverlayWindowProc;
    wc.hInstance = GetModuleHandleW(nullptr);
    wc.lpszClassName = kNativeMediaOfflineOverlayClass;
    wc.hCursor = LoadCursorW(nullptr, IDC_ARROW);
    if (RegisterClassW(&wc)) return true;
    return GetLastError() == ERROR_CLASS_ALREADY_EXISTS;
  }();
  return registered;
}

void SetNativeMediaOfflineOverlay(HWND hostWindow, bool visible) noexcept {
  if (!hostWindow || !IsWindow(hostWindow)) return;
  HWND overlay = FindWindowExW(
      hostWindow, nullptr, kNativeMediaOfflineOverlayClass, nullptr);
  if (!visible) {
    if (overlay) ShowWindow(overlay, SW_HIDE);
    return;
  }
  if (!overlay) {
    if (!EnsureNativeMediaOfflineOverlayClass()) return;
    overlay = CreateWindowExW(
        WS_EX_NOACTIVATE, kNativeMediaOfflineOverlayClass, L"",
        WS_CHILD | WS_CLIPSIBLINGS,
        0, 0, 1, 1, hostWindow, nullptr, GetModuleHandleW(nullptr), nullptr);
    if (!overlay) return;
  }
  RECT client{};
  if (!GetClientRect(hostWindow, &client)) return;
  const int width = std::max<LONG>(1, client.right - client.left);
  const int height = std::max<LONG>(1, client.bottom - client.top);
  SetWindowPos(
      overlay, HWND_TOP, 0, 0, width, height,
      SWP_NOACTIVATE | SWP_SHOWWINDOW);
  InvalidateRect(overlay, nullptr, TRUE);
}

ComPtr<ICoreWebView2NavigationCompletedEventHandler>
WrapNativeMediaNavigationCompletedHandler(
    ICoreWebView2NavigationCompletedEventHandler* handler,
    HWND hostWindow) noexcept {
  if (!handler) return {};
  ComPtr<ICoreWebView2NavigationCompletedEventHandler> inner = handler;
  return Callback<ICoreWebView2NavigationCompletedEventHandler>(
      [inner = std::move(inner), hostWindow](
          ICoreWebView2* sender,
          ICoreWebView2NavigationCompletedEventArgs* args) noexcept -> HRESULT {
        if (args) {
          BOOL succeeded = FALSE;
          if (SUCCEEDED(args->get_IsSuccess(&succeeded))) {
            if (succeeded) {
              SetNativeMediaOfflineOverlay(hostWindow, false);
            } else {
              COREWEBVIEW2_WEB_ERROR_STATUS status{};
              if (SUCCEEDED(args->get_WebErrorStatus(&status)) &&
                  status == COREWEBVIEW2_WEB_ERROR_STATUS_DISCONNECTED) {
                SetNativeMediaOfflineOverlay(hostWindow, true);
              }
            }
          }
        }
        if (!inner) return S_OK;
        try {
          return inner->Invoke(sender, args);
        } catch (...) {
          return E_FAIL;
        }
      });
}
}  // namespace

// The media panel owns phase cadence, navigation, event-driven playback policy
// and trusted WebView2 input. TVer episode choice is cloud-queue based; the old
// renderer-level two-series alternation no longer participates in navigation.
#undef add_NavigationCompleted
#define add_NavigationCompleted(handler, token)                              \
  add_NavigationCompleted(                                                   \
      WrapNativeMediaNavigationCompletedHandler((handler), hostWindow_).Get(), \
      (token))
#include "renderer_panels/media_section.inc"
#undef add_NavigationCompleted

// Rain-radar rendering is intentionally separate from the media/WebView module.
#include "renderer_panels/radar_section.inc"

namespace {
HWND NativeMediaContainerWindow() noexcept {
  const HWND root = FindNativeMediaRootWindow();
  return root && IsWindow(root) ? GetDlgItem(root, kNativeMediaId) : nullptr;
}

HWND FindNativeMediaHostWindow(HWND mediaWindow) noexcept {
  if (!mediaWindow || !IsWindow(mediaWindow)) return nullptr;
  return FindWindowExW(
      mediaWindow, nullptr, kNativeMvPanelHostClass, nullptr);
}
}  // namespace

void SetNativeMediaPanelMuted(bool muted) noexcept {
  if (gNativeMediaMuted == muted) return;
  gNativeMediaMuted = muted;

  const HWND mediaWindow = NativeMediaContainerWindow();
  if (!mediaWindow || !IsWindow(mediaWindow)) return;
  const HWND hostWindow = FindNativeMediaHostWindow(mediaWindow);
  if (!hostWindow || !IsWindow(hostWindow)) return;
  auto* host = reinterpret_cast<NativeMediaPanelHost*>(
      GetWindowLongPtrW(hostWindow, GWLP_USERDATA));
  if (host) host->SetMuted(muted);
}

#include "renderer_panels/data_sections.inc"
#undef StretchRadarInto
