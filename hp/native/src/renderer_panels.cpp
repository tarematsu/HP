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
ComPtr<ICoreWebView2> gNativeMediaNetworkWebView;
ComPtr<ICoreWebView2Environment> gNativeMediaNetworkEnvironment;
EventRegistrationToken gNativeMediaNetworkToken{};
std::atomic<bool> gNativeMediaNetworkBlocked{false};
bool gNativeMediaMuted = false;

constexpr wchar_t kNativeMediaPlaybackBlockScript[] = LR"JS(
(() => {
  window.__homePanelNativeMediaNetworkBlocked = true;
  const proto = window.HTMLMediaElement && HTMLMediaElement.prototype;
  if (proto && !window.__homePanelNativeMediaOriginalPlay) {
    window.__homePanelNativeMediaOriginalPlay = proto.play;
    proto.play = function() {
      if (window.__homePanelNativeMediaNetworkBlocked) {
        try { this.pause(); } catch (_) {}
        return Promise.reject(new DOMException('Media blocked', 'NotAllowedError'));
      }
      return window.__homePanelNativeMediaOriginalPlay.apply(this, arguments);
    };
  }
  const stop = () => {
    document.querySelectorAll('audio, video').forEach(media => {
      try { media.pause(); } catch (_) {}
    });
    const player = document.querySelector('#movie_player');
    try {
      if (player && typeof player.pauseVideo === 'function') player.pauseVideo();
    } catch (_) {}
  };
  stop();
  if (!window.__homePanelNativeMediaBlockTimer) {
    window.__homePanelNativeMediaBlockTimer = setInterval(stop, 250);
  }
  return true;
})()
)JS";

constexpr wchar_t kNativeMediaPlaybackUnblockScript[] = LR"JS(
(() => {
  window.__homePanelNativeMediaNetworkBlocked = false;
  if (window.__homePanelNativeMediaBlockTimer) {
    clearInterval(window.__homePanelNativeMediaBlockTimer);
    window.__homePanelNativeMediaBlockTimer = 0;
  }
  const proto = window.HTMLMediaElement && HTMLMediaElement.prototype;
  if (proto && window.__homePanelNativeMediaOriginalPlay) {
    proto.play = window.__homePanelNativeMediaOriginalPlay;
    window.__homePanelNativeMediaOriginalPlay = null;
  }
  return true;
})()
)JS";

void ApplyNativeMediaNetworkBlocked(bool blocked) noexcept {
  gNativeMediaNetworkBlocked.store(blocked, std::memory_order_release);
  if (!gNativeMediaNetworkWebView) return;
  try {
    if (blocked) {
      gNativeMediaNetworkWebView->ExecuteScript(
          kNativeMediaPlaybackBlockScript, nullptr);
      gNativeMediaNetworkWebView->Stop();
    } else {
      gNativeMediaNetworkWebView->ExecuteScript(
          kNativeMediaPlaybackUnblockScript, nullptr);
      gNativeMediaNetworkWebView->Reload();
    }
  } catch (...) {
  }
}

void RegisterNativeMediaAudioWebView(
    ICoreWebView2* webview, ICoreWebView2Environment* environment) noexcept {
  if (gNativeMediaNetworkWebView && gNativeMediaNetworkToken.value != 0) {
    gNativeMediaNetworkWebView->remove_WebResourceRequested(
        gNativeMediaNetworkToken);
  }
  gNativeMediaNetworkToken = {};
  gNativeMediaNetworkWebView.Reset();
  gNativeMediaNetworkEnvironment.Reset();
  gNativeMediaAudioWebView.Reset();
  if (!webview) return;

  ComPtr<ICoreWebView2_8> audioWebView;
  if (SUCCEEDED(webview->QueryInterface(IID_PPV_ARGS(&audioWebView))) &&
      audioWebView) {
    gNativeMediaAudioWebView = audioWebView;
    gNativeMediaAudioWebView->put_IsMuted(gNativeMediaMuted ? TRUE : FALSE);
  }

  gNativeMediaNetworkWebView = webview;
  gNativeMediaNetworkEnvironment = environment;
  if (gNativeMediaNetworkEnvironment &&
      SUCCEEDED(gNativeMediaNetworkWebView->AddWebResourceRequestedFilter(
          L"*", COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL))) {
    gNativeMediaNetworkWebView->add_WebResourceRequested(
        Callback<ICoreWebView2WebResourceRequestedEventHandler>(
            [](ICoreWebView2*, ICoreWebView2WebResourceRequestedEventArgs* args)
                -> HRESULT {
              if (!args ||
                  !gNativeMediaNetworkBlocked.load(std::memory_order_acquire) ||
                  !gNativeMediaNetworkEnvironment) {
                return S_OK;
              }
              ComPtr<ICoreWebView2WebResourceResponse> response;
              if (SUCCEEDED(gNativeMediaNetworkEnvironment->CreateWebResourceResponse(
                      nullptr, 503, L"Media Blocked",
                      L"Cache-Control: no-store\r\n", &response)) && response) {
                args->put_Response(response.Get());
              }
              return S_OK;
            }).Get(),
        &gNativeMediaNetworkToken);
  }

  if (gNativeMediaNetworkBlocked.load(std::memory_order_acquire)) {
    if (gNativeMediaAudioWebView) gNativeMediaAudioWebView->put_IsMuted(TRUE);
    gNativeMediaNetworkWebView->ExecuteScript(
        kNativeMediaPlaybackBlockScript, nullptr);
    gNativeMediaNetworkWebView->Stop();
  }
}
}  // namespace

void SetNativeMediaPanelMuted(bool muted) noexcept {
  gNativeMediaMuted = muted;
  if (gNativeMediaAudioWebView) {
    gNativeMediaAudioWebView->put_IsMuted(muted ? TRUE : FALSE);
  }
  ApplyNativeMediaNetworkBlocked(muted);
  SetSpotifyMediaNetworkBlocked(muted);
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
// and registers the shared media-audio/network WebView.
#define Navigate(url) Navigate(ResolveNativeMediaNavigateUrl((url)))
#define get_CoreWebView2(out)                                                    \
  get_CoreWebView2(out);                                                        \
  RegisterNativeMediaAudioWebView(webview_.Get(), environment_.Get())
#include "renderer_panels/media_section.inc"
#undef get_CoreWebView2
#undef Navigate
#include "renderer_panels/data_sections.inc"