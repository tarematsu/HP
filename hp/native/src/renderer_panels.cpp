// Kept as one translation unit so cached GDI primitives remain shared.
// Fragment boundaries follow complete responsibilities and never split functions.
#if 0  // Stationhead renderer helpers are intentionally disabled.
#include "stationhead_native_stats.h"
#include "stationhead_play_summary.h"
#endif
#include "native_media_audio.h"
#include "shared_webview_environment.h"
#include "spotify_webviews.h"
#include "version.h"
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

#define SplitSidebarSections SplitRearrangedSidebarSections
#define SplitMainSections SplitRearrangedMainSections
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
}  // namespace

// The media panel owns phase cadence, navigation, event-driven playback policy
// and trusted WebView2 input. TVer episode choice is cloud-queue based; the old
// renderer-level two-series alternation no longer participates in navigation.
#include "renderer_panels/media_section.inc"

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
