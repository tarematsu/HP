// Native media composition: shared constants/scripts plus focused host/window/radar modules.
namespace {
constexpr wchar_t kNativeMvPanelHostClass[] = L"HomePanelNativeMvPanel";
constexpr wchar_t kNativeMediaYoutubeUrl[] =
    L"https://www.youtube.com/playlist?list=PLMWqSdpIVl30";
// TVer starts from the cloud-owned episode feed. The tiny data document stays
// black, retries transient feed failures in-place, and navigates straight to the
// selected /episodes/ URL; the native app never needs to render a /series/ page.
constexpr wchar_t kNativeMediaTverUrl[] =
    L"data:text/html;charset=utf-8,%3C%21doctype%20html%3E%3Cmeta%20charset%3Dutf-8%3E%3Cstyle%3Ehtml%2Cbody%7Bmargin%3A0%3Bbackground%3A%23000%7D%3C%2Fstyle%3E%3Cscript%3Econst%20f%3D%27https%3A%2F%2Fhomepanel-cloud.tarematsu.workers.dev%2Fv1%2Fnative%2Ftver-feed%27%3Bconst%20go%3Dasync%28%29%3D%3E%7Btry%7Bconst%20r%3Dawait%20fetch%28f%2C%7Bcache%3A%27no-store%27%7D%29%3Bif%28%21r.ok%29throw%200%3Bconst%20d%3Dawait%20r.json%28%29%3Bconst%20u%3DArray.isArray%28d%3F.episodes%29%3Fd.episodes.map%28x%3D%3EString%28x%3F.url%7C%7C%27%27%29%29.find%28x%3D%3E%2F%5Ehttps%3A%5C%2F%5C%2Ftver%5C.jp%5C%2Fepisodes%5C%2F%5BA-Za-z0-9_-%5D%2B%24%2F.test%28x%29%29%3A%27%27%3Bif%28u%29%7Blocation.replace%28u%2B%27%3Fhomepanel_launch%3D1%27%29%3Breturn%7D%7Dcatch%28_%29%7B%7DsetTimeout%28go%2C3000%29%7D%3Bgo%28%29%3C%2Fscript%3E";
constexpr wchar_t kNativeMediaProfile[] = L"media-youtube";
constexpr UINT_PTR kNativeMediaPhaseTimer = 0x4D560001;
constexpr UINT_PTR kNativeMediaPlayAllTimer = 0x4D560002;
constexpr UINT_PTR kNativeMediaNavigationRetryTimer = 0x4D560005;
constexpr UINT_PTR kNativeMediaYoutubeWatchdogTimer = 0x4D560006;
constexpr UINT_PTR kNativeMediaTverWatchdogTimer = 0x4D560007;
constexpr UINT kNativeMediaPhaseMs = 60U * 60U * 1000U;
constexpr UINT kNativeMediaPlayAllRetryMs = 500U;
constexpr UINT kNativeMediaNavigationRetryMs = 3U * 1000U;
// Healthy YouTube playback is event-driven; the timer is only a backstop.
constexpr UINT kNativeMediaYoutubeWatchdogHealthyMs = 30U * 1000U;
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

// Legacy symbol retained as a routing key for media_host.inc. The wrapper
// resolves it to the event-aware policy in media_youtube_control_recovery.inc.
constexpr wchar_t kNativeMediaYoutubeWatchdogScript[] = LR"JS(
(() => null)()
)JS";

// TVer uses one routing key as well; episode pages resolve to the event-driven
// policy and trusted watchdog in media_section.inc.
constexpr const wchar_t* kNativeMediaTverLoopScript =
    kNativeMediaTverLoopStaticScript;
constexpr const wchar_t* kNativeMediaTverWatchdogScript =
    kNativeMediaTverWatchdogStaticScript;

LRESULT CALLBACK NativeMediaPanelWndProc(HWND, UINT, WPARAM, LPARAM);

#include "media_host.inc"
#include "media_host_window.inc"

}  // namespace

#include "media_radar_section.inc"