// Native media composition: shared constants/scripts plus focused host/window/radar modules.
namespace {
constexpr wchar_t kNativeMvPanelHostClass[] = L"HomePanelNativeMvPanel";
constexpr wchar_t kNativeMediaYoutubeUrl[] =
    L"https://www.youtube.com/playlist?list=PLMWqSdpIVl30";
constexpr wchar_t kNativeMediaTverUrl[] =
    L"https://tver.jp/series/srx97ftk3w";
constexpr wchar_t kNativeMediaProfile[] = L"media-youtube";
constexpr UINT_PTR kNativeMediaPhaseTimer = 0x4D560001;
constexpr UINT_PTR kNativeMediaPlayAllTimer = 0x4D560002;
constexpr UINT_PTR kNativeMediaNavigationRetryTimer = 0x4D560005;
constexpr UINT_PTR kNativeMediaYoutubeWatchdogTimer = 0x4D560006;
constexpr UINT_PTR kNativeMediaTverWatchdogTimer = 0x4D560007;
constexpr UINT kNativeMediaPhaseMs = 60U * 60U * 1000U;
constexpr UINT kNativeMediaPlayAllRetryMs = 500U;
constexpr UINT kNativeMediaNavigationRetryMs = 3U * 1000U;
constexpr UINT kNativeMediaYoutubeWatchdogHealthyMs = 10U * 1000U;
constexpr UINT kNativeMediaYoutubeWatchdogRecoveryMs = 2U * 1000U;
constexpr UINT kNativeMediaTverWatchdogMs = 30U * 1000U;
constexpr int kNativeMediaPlayAllRetryLimit = 20;
constexpr int kNativeMediaFallbackPlayAllXTenThousandths = 5850;
constexpr int kNativeMediaFallbackPlayAllYTenThousandths = 4250;

std::wstring FormatNativeMediaLocalHourMinute(const FILETIME& utcFileTime) noexcept {
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

constexpr wchar_t kNativeMediaPlayAllScript[] = LR"JS(
(() => {
  const styleId = 'homepanel-youtube-clean-player';
  if (!document.getElementById(styleId)) {
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      .html5-video-player .ytp-chrome-top,
      .html5-video-player .ytp-gradient-top,
      .html5-video-player .ytp-chrome-bottom,
      .html5-video-player .ytp-gradient-bottom {
        opacity: 0 !important;
        transition: none !important;
      }
      .html5-video-player .ytp-title,
      .html5-video-player .ytp-fullscreen-quick-actions,
      .html5-video-player .ytp-overlay-top-left,
      .html5-video-player .ytp-overlay-bottom-right,
      .html5-video-player yt-player-overlay-video-details-renderer,
      .html5-video-player .ytp-fullscreen-grid,
      .html5-video-player .ytp-fullscreen-grid-stills-container,
      .html5-video-player .ytp-fullscreen-grid-expand-button,
      .html5-video-player .ytp-caption-window-container {
        display: none !important;
      }
      ytd-watch-flexy #below,
      ytd-watch-flexy #secondary {
        content-visibility: hidden !important;
        contain-intrinsic-size: 1px 1px !important;
      }
    `;
    const parent = document.head || document.documentElement;
    if (parent) parent.appendChild(style);
  }

  const normalize = value => (value || '').replace(/\s+/g, ' ').trim();
  const candidates = Array.from(document.querySelectorAll(
      'button, a, tp-yt-paper-button, [role="button"]'));
  const target = candidates.find(element => {
    const label = normalize(element.getAttribute('aria-label'));
    const text = normalize(element.textContent);
    return label === 'すべて再生' || text === 'すべて再生' ||
           /^Play all(?:\s|$)/i.test(label) ||
           /^Play all(?:\s|$)/i.test(text);
  });
  if (!target || window.innerWidth <= 0 || window.innerHeight <= 0) return null;
  const rect = target.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  return [
    Math.max(0, Math.min(10000, Math.round(
        ((rect.left + rect.width / 2) / window.innerWidth) * 10000))),
    Math.max(0, Math.min(10000, Math.round(
        ((rect.top + rect.height / 2) / window.innerHeight) * 10000)))
  ];
})()
)JS";

constexpr wchar_t kNativeMediaYoutubeWatchdogScript[] = LR"JS(
(() => {
  const player = document.querySelector('#movie_player');
  if (!player || window.innerWidth <= 0 || window.innerHeight <= 0) return null;
  try {
    if (typeof player.setPlaybackQualityRange === 'function') {
      player.setPlaybackQualityRange('large', 'large');
    }
    if (typeof player.setPlaybackQuality === 'function') {
      player.setPlaybackQuality('large');
    }
  } catch (_) {
  }
  const video = document.querySelector('video');
  const explicitError = player.classList.contains('ytp-error') ||
      document.querySelector(
          '.ytp-error, .ytp-error-content-wrap, .ytp-error-content, '
          + 'yt-player-error-message-renderer, ytd-player-error-message-renderer');
  if ((video && video.error) || explicitError) return 'reload';

  const isClickable = element => {
    if (!element || element.disabled ||
        element.getAttribute('aria-disabled') === 'true' ||
        element.getAttribute('aria-hidden') === 'true') return false;
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' &&
           style.pointerEvents !== 'none' && rect.width > 0 && rect.height > 0;
  };

  const captionsButton = player.querySelector('.ytp-subtitles-button');
  if (captionsButton && captionsButton.getAttribute('aria-pressed') === 'true') {
    try {
      captionsButton.click();
    } catch (_) {
    }
  } else {
    try {
      if (typeof player.setOption === 'function') {
        player.setOption('captions', 'track', {});
      }
    } catch (_) {
    }
  }

  const selectors = [
    '.ytp-ad-skip-button',
    '.ytp-ad-skip-button-modern',
    '.ytp-skip-ad-button',
    '.videoAdUiSkipButton',
    '.ytp-ad-skip-button-slot button',
    '.ytp-ad-skip-button-container button'
  ];
  let target = Array.from(player.querySelectorAll(selectors.join(',')))
      .find(isClickable) || null;
  if (!target) {
    const fullscreen = document.fullscreenElement ||
        player.classList.contains('ytp-fullscreen');
    if (fullscreen) return null;
    target = player.querySelector('.ytp-fullscreen-button');
    if (!isClickable(target)) return null;
  }

  const rect = target.getBoundingClientRect();
  return [
    Math.max(0, Math.min(10000, Math.round(
        ((rect.left + rect.width / 2) / window.innerWidth) * 10000))),
    Math.max(0, Math.min(10000, Math.round(
        ((rect.top + rect.height / 2) / window.innerHeight) * 10000)))
  ];
})()
)JS";

// TVer has one effective implementation. The static scripts are declared in
// media_tver_ad_guard.inc before this implementation is included.
constexpr const wchar_t* kNativeMediaTverLoopScript =
    kNativeMediaTverLoopStaticScript;
constexpr const wchar_t* kNativeMediaTverWatchdogScript =
    kNativeMediaTverWatchdogStaticScript;

LRESULT CALLBACK NativeMediaPanelWndProc(HWND, UINT, WPARAM, LPARAM);

#include "media_host.inc"
#include "media_host_window.inc"

}  // namespace

#include "media_radar_section.inc"
