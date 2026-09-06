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
ComPtr<ICoreWebView2_8> gNativeMediaAudioWebView;
bool gNativeMediaMuted = false;

void RegisterNativeMediaAudioWebView(ICoreWebView2* webview) noexcept {
  gNativeMediaAudioWebView.Reset();
  if (!webview) return;
  ComPtr<ICoreWebView2_8> audioWebView;
  if (FAILED(webview->QueryInterface(IID_PPV_ARGS(&audioWebView))) ||
      !audioWebView) {
    return;
  }
  gNativeMediaAudioWebView = audioWebView;
  gNativeMediaAudioWebView->put_IsMuted(gNativeMediaMuted ? TRUE : FALSE);
}
}  // namespace

void SetNativeMediaPanelMuted(bool muted) noexcept {
  gNativeMediaMuted = muted;
  if (gNativeMediaAudioWebView) {
    gNativeMediaAudioWebView->put_IsMuted(muted ? TRUE : FALSE);
  }
}

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
// trusted input. This composition layer only resolves the active TVer series URL
// and registers the shared media-audio WebView.
#define Navigate(url) Navigate(ResolveNativeMediaNavigateUrl((url)))
#define get_CoreWebView2(out)                                                    \
  get_CoreWebView2(out); RegisterNativeMediaAudioWebView(webview_.Get())
#include "renderer_panels/media_section.inc"
#undef get_CoreWebView2
#undef Navigate
#include "renderer_panels/data_sections.inc"
