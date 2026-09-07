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

fs::path NativeMediaDataDir() {
  wchar_t executable[MAX_PATH * 4]{};
  if (GetModuleFileNameW(nullptr, executable, _countof(executable)) == 0) {
    return fs::path(L"data");
  }
  return fs::path(executable).parent_path() / L"data";
}
}  // namespace

namespace {
constexpr wchar_t kNativeMediaSakuraMeetsSeriesUrl[] =
    L"https://tver.jp/series/srx97ftk3w";
constexpr wchar_t kNativeMediaDeathGameSeriesUrl[] =
    L"https://tver.jp/series/srkzm5wbvp";
bool gNativeMediaTverUseDeathGame = false;

const wchar_t* ResolveNativeMediaNavigateUrl(const wchar_t* url) noexcept {
  if (!url) return url;
  if (wcscmp(url, kNativeMediaSakuraMeetsSeriesUrl) != 0 &&
      wcscmp(url, kNativeMediaDeathGameSeriesUrl) != 0) {
    return url;
  }
  return gNativeMediaTverUseDeathGame ? kNativeMediaDeathGameSeriesUrl
                                      : kNativeMediaSakuraMeetsSeriesUrl;
}

void AdvanceNativeMediaTverSeries() noexcept {
  gNativeMediaTverUseDeathGame = !gNativeMediaTverUseDeathGame;
}
}  // namespace

// The media panel owns cadence, static playback scripts, series advancement and
// trusted input. This composition layer only resolves the active TVer series URL.
#define Navigate(url) Navigate(ResolveNativeMediaNavigateUrl((url)))
#include "renderer_panels/media_section.inc"
#undef Navigate

namespace {
HWND NativeMediaRadarWindow() noexcept {
  const HWND root = FindNativeMediaRootWindow();
  return root && IsWindow(root) ? GetDlgItem(root, kNativeRadarId) : nullptr;
}

HWND FindNativeMediaHostWindow(HWND radarWindow) noexcept {
  if (!radarWindow || !IsWindow(radarWindow)) return nullptr;
  return FindWindowExW(
      radarWindow, nullptr, kNativeMvPanelHostClass, nullptr);
}

bool EnsureNativeMediaHostClass() noexcept {
  WNDCLASSW existing{};
  if (GetClassInfoW(
          GetModuleHandleW(nullptr), kNativeMvPanelHostClass, &existing)) {
    return true;
  }
  WNDCLASSW windowClass{};
  windowClass.lpfnWndProc = NativeMediaPanelWndProc;
  windowClass.hInstance = GetModuleHandleW(nullptr);
  windowClass.lpszClassName = kNativeMvPanelHostClass;
  windowClass.hCursor = nullptr;
  windowClass.hbrBackground =
      static_cast<HBRUSH>(GetStockObject(BLACK_BRUSH));
  SetLastError(ERROR_SUCCESS);
  return RegisterClassW(&windowClass) != 0 ||
         GetLastError() == ERROR_CLASS_ALREADY_EXISTS;
}

bool CreateNativeMediaPlaceholderHost(
    HWND radarWindow, const RECT& bounds) noexcept {
  if (!radarWindow || !IsWindow(radarWindow) ||
      bounds.right <= bounds.left || bounds.bottom <= bounds.top ||
      !EnsureNativeMediaHostClass()) {
    return false;
  }
  auto* state = new (std::nothrow) NativeMediaPanelHost(NativeMediaDataDir());
  if (!state) return false;
  const HWND host = CreateWindowExW(
      0, kNativeMvPanelHostClass, L"",
      WS_CHILD | WS_CLIPCHILDREN | WS_CLIPSIBLINGS | WS_VISIBLE,
      bounds.left, bounds.top, std::max(1L, bounds.right - bounds.left),
      std::max(1L, bounds.bottom - bounds.top), radarWindow, nullptr,
      GetModuleHandleW(nullptr), state);
  if (!host) {
    delete state;
    return false;
  }
  // Deliberately do not call Start(). The HWND remains as a placeholder so
  // normal dashboard paints cannot recreate a WebView while media mute is ON.
  return true;
}

void SuspendNativeMediaPanelWebView() noexcept {
  const HWND radarWindow = NativeMediaRadarWindow();
  if (!radarWindow || !IsWindow(radarWindow)) return;
  RECT bounds{};
  if (!GetClientRect(radarWindow, &bounds) ||
      bounds.right <= bounds.left || bounds.bottom <= bounds.top) {
    return;
  }
  const HWND hostWindow = FindNativeMediaHostWindow(radarWindow);
  if (hostWindow && IsWindow(hostWindow)) {
    // WM_NCDESTROY calls NativeMediaPanelHost::Shutdown(), closes the controller,
    // releases the WebView/environment, stops timers and deletes the old state.
    DestroyWindow(hostWindow);
  }
  CreateNativeMediaPlaceholderHost(radarWindow, bounds);
}

void ResumeNativeMediaPanelWebView() noexcept {
  const HWND radarWindow = NativeMediaRadarWindow();
  if (!radarWindow || !IsWindow(radarWindow)) return;
  HWND hostWindow = FindNativeMediaHostWindow(radarWindow);
  if (!hostWindow || !IsWindow(hostWindow)) {
    RECT bounds{};
    if (!GetClientRect(radarWindow, &bounds) ||
        bounds.right <= bounds.left || bounds.bottom <= bounds.top) {
      return;
    }
    EnsureNativeMvPanel(radarWindow, NativeMediaDataDir(), bounds);
    return;
  }
  auto* host = reinterpret_cast<NativeMediaPanelHost*>(
      GetWindowLongPtrW(hostWindow, GWLP_USERDATA));
  if (host) host->Start();
}
}  // namespace

void SetNativeMediaPanelMuted(bool muted) noexcept {
  if (gNativeMediaMuted == muted) return;
  gNativeMediaMuted = muted;
  if (muted) {
    SuspendNativeMediaPanelWebView();
  } else {
    ResumeNativeMediaPanelWebView();
  }
  // Spotify's existing blocked-state transition already closes every controller
  // and host slot on ON, then recreates fresh hosts/controllers and navigates on OFF.
  SetSpotifyMediaNetworkBlocked(muted);
}

#include "renderer_panels/data_sections.inc"