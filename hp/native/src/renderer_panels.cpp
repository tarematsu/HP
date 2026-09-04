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
constexpr UINT kNativeMediaYoutubePhaseOverrideMs = 30U * 60U * 1000U;
constexpr UINT kNativeMediaTverPhaseOverrideMs = 90U * 60U * 1000U;
constexpr wchar_t kNativeMediaSakuraMeetsSeriesUrl[] =
    L"https://tver.jp/series/srx97ftk3w";
constexpr wchar_t kNativeMediaDeathGameSeriesUrl[] =
    L"https://tver.jp/series/srkzm5wbvp";
constexpr UINT kNativeMediaTverWakeIntervalMs = 350U;
constexpr UINT kNativeMediaTverWakeAttempts = 10U;
HWND gNativeMediaTverWakeWindow = nullptr;
UINT gNativeMediaTverWakeCount = 0;
UINT gNativeMediaTverSteadyIntervalMs = 2000U;
bool gNativeMediaTverUseDeathGame = false;
std::wstring gNativeMediaPhaseOverlayText;

constexpr wchar_t kNativeMediaTverLoopOverrideScript[] = LR"JS(
(() => {
  if (window.__homePanelSakuraMeetsLoopTimer) return;
  const sakuraSeriesPath = '/series/srx97ftk3w';
  const deathGameSeriesPath = '/series/srkzm5wbvp';
  const seriesPathKey = '__homePanelTverSeriesPath';
  const playbackRate = 1.75;
  const normalize = value => (value || '').replace(/\s+/g, ' ').trim();
  const isDisplayed = element => {
    if (!element) return false;
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' &&
           rect.width > 0 && rect.height > 0;
  };
  const labelOf = element => normalize(
      (element.getAttribute('aria-label') || '') + ' ' +
      (element.getAttribute('title') || '') + ' ' +
      (element.textContent || ''));
  const qualityName = element => labelOf(element)
      .replace(/[（(](?:選択中|設定中)[）)]/g, '')
      .replace(/画質$/, '')
      .trim();
  const storedSeriesPath = () => {
    try {
      const stored = sessionStorage.getItem(seriesPathKey);
      if (stored === sakuraSeriesPath || stored === deathGameSeriesPath) return stored;
    } catch (_) {
    }
    return sakuraSeriesPath;
  };
  const rememberSeriesPath = path => {
    if (path !== sakuraSeriesPath && path !== deathGameSeriesPath) return;
    try { sessionStorage.setItem(seriesPathKey, path); } catch (_) {}
  };

  const openPreferredEpisode = () => {
    const seriesPath = location.pathname;
    rememberSeriesPath(seriesPath);
    const links = Array.from(document.querySelectorAll('a[href*="/episodes/"]'))
        .filter(link => link.href && isDisplayed(link));
    if (!links.length) return;
    let target = null;
    if (seriesPath === deathGameSeriesPath) {
      target = links.find(link =>
          /予告|\bPR\b|ティザー|teaser|trailer/i.test(labelOf(link))) || links[0];
    } else {
      target = links.find(link => /最新話|最新回/.test(labelOf(link))) ||
          links.find(link => !/(放課後トーク|予告|\bPR\b)/i.test(labelOf(link))) ||
          links[0];
    }
    if (target && target.href) location.replace(target.href);
  };

  const ensureEpisodePlayback = () => {
    const path = location.pathname;
    const previewMode = storedSeriesPath() === deathGameSeriesPath;
    let state = window.__homePanelSakuraMeetsState;
    if (!state || state.path !== path || state.previewMode !== previewMode) {
      state = {
        path,
        previewMode,
        maxDuration: 0,
        maxTime: 0,
        lowQualitySet: false,
        restartRequested: false,
      };
      window.__homePanelSakuraMeetsState = state;
    }
    const videos = Array.from(document.querySelectorAll('video'));
    const video = videos.find(isDisplayed) || videos[0] || null;
    if (video) {
      video.defaultPlaybackRate = playbackRate;
      if (video.playbackRate !== playbackRate) video.playbackRate = playbackRate;
      if (Number.isFinite(video.duration)) {
        state.maxDuration = Math.max(state.maxDuration, video.duration);
      }
      if (Number.isFinite(video.currentTime)) {
        state.maxTime = Math.max(state.maxTime, video.currentTime);
      }
      const completedPreview = state.previewMode &&
          state.maxDuration >= 10 && state.maxTime >= 5;
      const completedEpisode = !state.previewMode &&
          state.maxDuration >= 600 && state.maxTime >= 300;
      if (video.ended && (completedPreview || completedEpisode)) {
        state.restartRequested = true;
        return;
      }
      video.muted = false;
      if (video.volume === 0) video.volume = 1;
    }

    const controls = Array.from(document.querySelectorAll(
        'button, [role="button"], [role="menuitem"], [role="radio"], '
        + '[role="option"], li')).filter(isDisplayed);
    const qualityChoices = controls.filter(element =>
        /^(自動|高|中|低)$/.test(qualityName(element)));
    const qualityLabels = new Set(qualityChoices.map(qualityName));
    const lowOption = qualityChoices.find(element => qualityName(element) === '低') || null;
    const lowSelected = lowOption && (
        lowOption.getAttribute('aria-checked') === 'true' ||
        lowOption.getAttribute('aria-selected') === 'true' ||
        lowOption.getAttribute('data-state') === 'checked' ||
        /選択中|設定中/.test(labelOf(lowOption)));
    if (qualityLabels.size >= 3 && lowOption) {
      if (!lowSelected) {
        try { lowOption.click(); } catch (_) {}
      }
      state.lowQualitySet = true;
    } else {
      const currentQuality = qualityChoices.find(element =>
          /^(自動|高|中)$/.test(qualityName(element))) || null;
      if (currentQuality) {
        state.lowQualitySet = false;
        try { currentQuality.click(); } catch (_) {}
      } else if (lowOption) {
        state.lowQualitySet = true;
      }
    }

    const buttons = controls.filter(element =>
        element.matches('button, [role="button"]'));
    const playButton = buttons.find(button => {
      const label = labelOf(button).toLowerCase();
      return label === '再生' || label === '再生する' ||
             label === '動画を再生' || label === 'play' ||
             label === 'play video';
    });
    if (video && video.paused && !video.ended) {
      if (playButton) playButton.click();
      try {
        const promise = video.play();
        if (promise && typeof promise.catch === 'function') {
          promise.catch(() => { if (playButton) playButton.click(); });
        }
      } catch (_) {
        if (playButton) playButton.click();
      }
    } else if (!video && playButton) {
      playButton.click();
    }
  };

  const ensure = () => {
    try {
      if (location.hostname !== 'tver.jp') {
        location.replace('https://tver.jp' + storedSeriesPath());
      } else if (location.pathname.startsWith('/series/')) {
        openPreferredEpisode();
      } else if (location.pathname.startsWith('/episodes/')) {
        ensureEpisodePlayback();
      } else {
        location.replace('https://tver.jp' + storedSeriesPath());
      }
    } catch (_) {
    }
  };
  ensure();
  window.__homePanelSakuraMeetsLoopTimer = window.setInterval(ensure, 2000);
})()
)JS";

constexpr wchar_t kNativeMediaTverWatchdogOverrideScript[] = LR"JS(
(() => {
  if (location.hostname !== 'tver.jp' ||
      !location.pathname.startsWith('/episodes/')) return null;
  const state = window.__homePanelSakuraMeetsState;
  if (state && state.restartRequested) return 'restart';
  const normalize = value => (value || '').replace(/\s+/g, ' ').trim();
  const visible = element => {
    if (!element || element.disabled ||
        element.getAttribute('aria-disabled') === 'true' ||
        element.getAttribute('aria-hidden') === 'true') return false;
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' &&
           style.pointerEvents !== 'none' && rect.width > 0 && rect.height > 0;
  };
  const labelOf = element => normalize(
      (element.getAttribute('aria-label') || '') + ' ' +
      (element.getAttribute('title') || '') + ' ' +
      (element.textContent || ''));
  const point = element => {
    if (!visible(element) || window.innerWidth <= 0 || window.innerHeight <= 0) {
      return null;
    }
    const rect = element.getBoundingClientRect();
    return [
      Math.max(0, Math.min(10000, Math.round(
          ((rect.left + rect.width / 2) / window.innerWidth) * 10000))),
      Math.max(0, Math.min(10000, Math.round(
          ((rect.top + rect.height / 2) / window.innerHeight) * 10000)))
    ];
  };

  const video = Array.from(document.querySelectorAll('video')).find(visible) || null;
  const controls = Array.from(document.querySelectorAll('button, [role="button"]'));
  const fullscreen = document.fullscreenElement || document.webkitFullscreenElement ||
      controls.some(element => {
        if (!visible(element)) return false;
        const label = labelOf(element).toLowerCase();
        return /全画面を終了|全画面解除|フルスクリーンを終了/.test(label) ||
               label.includes('exit fullscreen');
      });
  if (fullscreen) return null;
  const fullscreenButton = controls.find(element => {
    if (!visible(element)) return false;
    const label = labelOf(element).toLowerCase();
    if (/終了|解除/.test(label) || label.includes('exit fullscreen')) return false;
    return /全画面|フルスクリーン/.test(label) || label.includes('fullscreen');
  });
  return fullscreenButton ? point(fullscreenButton) : (video ? point(video) : null);
})()
)JS";

constexpr wchar_t kNativeMediaTverForceFullscreenAfterClickScript[] = LR"JS(
(() => {
  if (window.__homePanelTverFullscreenPending) return;
  window.__homePanelTverFullscreenPending = true;
  window.setTimeout(async () => {
    window.__homePanelTverFullscreenPending = false;
    try {
      if (document.fullscreenElement || document.webkitFullscreenElement) return;
      const visible = element => {
        if (!element) return false;
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' &&
               rect.width > 0 && rect.height > 0;
      };
      const videos = Array.from(document.querySelectorAll('video'));
      const video = videos.find(visible) || videos[0] || null;
      if (!video) return;
      const candidates = [video, video.parentElement].filter(Boolean);
      for (const target of candidates) {
        const request = target.requestFullscreen || target.webkitRequestFullscreen;
        if (typeof request !== 'function') continue;
        try {
          const result = request.call(target);
          if (result && typeof result.then === 'function') await result;
          if (document.fullscreenElement || document.webkitFullscreenElement) return;
        } catch (_) {
        }
      }
    } catch (_) {
    }
  }, 180);
})()
)JS";

UINT NativeMediaSendInputWithTverFullscreen(
    bool tver, ICoreWebView2* webview, UINT count, LPINPUT inputs,
    int inputSize) noexcept {
  const UINT sent = ::SendInput(count, inputs, inputSize);
  if (tver && sent > 0 && webview) {
    webview->ExecuteScript(kNativeMediaTverForceFullscreenAfterClickScript, nullptr);
  }
  return sent;
}

UINT NativeMediaPhaseIntervalMs(bool tver) noexcept {
  return tver ? kNativeMediaTverPhaseOverrideMs
              : kNativeMediaYoutubePhaseOverrideMs;
}

std::wstring NativeMediaLocalHourMinute(const FILETIME& utcFileTime) noexcept {
  SYSTEMTIME utc{};
  SYSTEMTIME local{};
  if (!FileTimeToSystemTime(&utcFileTime, &utc) ||
      !SystemTimeToTzSpecificLocalTime(nullptr, &utc, &local)) {
    return L"--:--";
  }
  std::wstring value = L"00:00";
  value[0] = static_cast<wchar_t>(L'0' + local.wHour / 10);
  value[1] = static_cast<wchar_t>(L'0' + local.wHour % 10);
  value[3] = static_cast<wchar_t>(L'0' + local.wMinute / 10);
  value[4] = static_cast<wchar_t>(L'0' + local.wMinute % 10);
  return value;
}

void CaptureNativeMediaPhaseOverlay(bool tver) noexcept {
  FILETIME startUtc{};
  GetSystemTimeAsFileTime(&startUtc);
  ULARGE_INTEGER endTicks{};
  endTicks.LowPart = startUtc.dwLowDateTime;
  endTicks.HighPart = startUtc.dwHighDateTime;
  endTicks.QuadPart +=
      static_cast<ULONGLONG>(NativeMediaPhaseIntervalMs(tver)) * 10000ULL;
  FILETIME endUtc{};
  endUtc.dwLowDateTime = endTicks.LowPart;
  endUtc.dwHighDateTime = endTicks.HighPart;
  gNativeMediaPhaseOverlayText = tver ? L"TVer " : L"YouTube ";
  gNativeMediaPhaseOverlayText += NativeMediaLocalHourMinute(startUtc);
  gNativeMediaPhaseOverlayText += L"–";
  gNativeMediaPhaseOverlayText += NativeMediaLocalHourMinute(endUtc);
}

std::wstring RewriteNativeMediaExecuteScript(const wchar_t* script) {
  if (!script) return {};
  std::wstring value(script);
  if (value.find(L"__homePanelSakuraMeetsLoopTimer") != std::wstring::npos) {
    return kNativeMediaTverLoopOverrideScript;
  }
  if (value.find(L"window.__homePanelSakuraMeetsState") != std::wstring::npos &&
      value.find(L"fullscreenButton") != std::wstring::npos) {
    return kNativeMediaTverWatchdogOverrideScript;
  }
  if (gNativeMediaPhaseOverlayText.empty() ||
      value.find(L"__homePanelMediaPhaseTime") == std::wstring::npos) {
    return value;
  }
  constexpr std::wstring_view marker = L"  const text = '";
  const size_t begin = value.find(marker);
  if (begin == std::wstring::npos) return value;
  const size_t textBegin = begin + marker.size();
  const size_t end = value.find(L"';", textBegin);
  if (end == std::wstring::npos) return value;
  value.replace(textBegin, end - textBegin, gNativeMediaPhaseOverlayText);
  return value;
}

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

LONG NativeMediaPointerAbsolute(int value, int origin, int span) noexcept {
  if (span <= 1) return 0;
  long long scaled =
      (static_cast<long long>(value - origin) * 65535LL) / (span - 1);
  scaled = std::max(0LL, std::min(65535LL, scaled));
  return static_cast<LONG>(scaled);
}

void WakeNativeMediaTverControls(HWND hwnd) noexcept {
  if (!hwnd || !IsWindow(hwnd)) return;
  RECT client{};
  if (!GetClientRect(hwnd, &client)) return;
  const LONG width = client.right - client.left;
  const LONG height = client.bottom - client.top;
  if (width <= 0 || height <= 0) return;

  const UINT attempt = gNativeMediaTverWakeCount++;
  const LONG yPercent = 35L + static_cast<LONG>(attempt % 3U) * 10L;
  POINT target{
      client.left + width / 2,
      client.top + static_cast<LONG>((static_cast<long long>(height) * yPercent) / 100LL)};
  if (!ClientToScreen(hwnd, &target)) return;

  const int virtualLeft = GetSystemMetrics(SM_XVIRTUALSCREEN);
  const int virtualTop = GetSystemMetrics(SM_YVIRTUALSCREEN);
  const int virtualWidth = GetSystemMetrics(SM_CXVIRTUALSCREEN);
  const int virtualHeight = GetSystemMetrics(SM_CYVIRTUALSCREEN);
  if (virtualWidth <= 1 || virtualHeight <= 1) return;

  INPUT input{};
  input.type = INPUT_MOUSE;
  input.mi.dx = NativeMediaPointerAbsolute(target.x, virtualLeft, virtualWidth);
  input.mi.dy = NativeMediaPointerAbsolute(target.y, virtualTop, virtualHeight);
  input.mi.dwFlags = MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE |
                     MOUSEEVENTF_VIRTUALDESK;
  SendInput(1, &input, sizeof(INPUT));
}

void CALLBACK NativeMediaTverWakeTimerProc(
    HWND hwnd, UINT, UINT_PTR timerId, DWORD) noexcept {
  if (hwnd && IsWindow(hwnd) && gNativeMediaTverWakeWindow == hwnd &&
      gNativeMediaTverWakeCount < kNativeMediaTverWakeAttempts) {
    WakeNativeMediaTverControls(hwnd);
  }
  if (hwnd && IsWindow(hwnd)) {
    PostMessageW(hwnd, WM_TIMER, timerId, 0);
    if (gNativeMediaTverWakeCount >= kNativeMediaTverWakeAttempts) {
      ::SetTimer(hwnd, timerId, gNativeMediaTverSteadyIntervalMs, nullptr);
    }
  }
}

UINT_PTR ArmNativeMediaTverWakeTimer(
    HWND hwnd, UINT_PTR timerId, UINT steadyIntervalMs) noexcept {
  gNativeMediaTverWakeWindow = hwnd;
  gNativeMediaTverWakeCount = 0;
  gNativeMediaTverSteadyIntervalMs = steadyIntervalMs;
  return ::SetTimer(hwnd, timerId, kNativeMediaTverWakeIntervalMs,
                    NativeMediaTverWakeTimerProc);
}
}  // namespace

// The media panel runs YouTube for 30 minutes and TVer for 90 minutes. Spotify
// follows the same phase boundary. TVer keeps the existing cleanup/recreate flow,
// but each completed item advances Sakura Meets <-> Death (Youth) Game. Until
// Death Game starts broadcasting, its series slot selects the available preview.
// TVer also uses a trusted native click followed by requestFullscreen so hidden
// or unlabeled fullscreen controls cannot leave the player stuck inline.
#define SetTimer(hwnd, timerId, interval, callback)                              \
  (((timerId) == kNativeMediaPhaseTimer                                         \
        ? (CaptureNativeMediaPhaseOverlay(phase_ == Phase::Tver),              \
           SetSpotifyMediaPhase(phase_ == Phase::Tver), 0)                     \
        : 0),                                                                   \
   ((timerId) == kNativeMediaTverWatchdogTimer                                  \
        ? ArmNativeMediaTverWakeTimer((hwnd), (timerId), (interval))           \
        : ::SetTimer(                                                           \
              (hwnd), (timerId),                                                \
              ((timerId) == kNativeMediaPhaseTimer                             \
                   ? NativeMediaPhaseIntervalMs(phase_ == Phase::Tver)         \
                   : (interval)),                                               \
              (callback))))
#define Navigate(url) Navigate(ResolveNativeMediaNavigateUrl((url)))
#define ClearBrowsingData(dataKinds, handler)                                   \
  ClearBrowsingData((AdvanceNativeMediaTverSeries(), (dataKinds)), (handler))
#define ExecuteScript(script, callback)                                         \
  ExecuteScript(RewriteNativeMediaExecuteScript((script)).c_str(), (callback))
#define get_CoreWebView2(out)                                                    \
  get_CoreWebView2(out); RegisterNativeMediaAudioWebView(webview_.Get())
#define SendInput(count, inputs, inputSize)                                      \
  NativeMediaSendInputWithTverFullscreen(                                       \
      phase_ == Phase::Tver, webview_.Get(), (count), (inputs), (inputSize))
#include "renderer_panels/media_section.inc"
#undef SendInput
#undef get_CoreWebView2
#undef ExecuteScript
#undef ClearBrowsingData
#undef Navigate
#undef SetTimer
#include "renderer_panels/data_sections.inc"