// TVer episode-page policy. This script owns dismissing blocking survey UI on
// an episode page, recovering playback with trusted input, restart signaling,
// and fullscreen entry. Series navigation lives in media_tver_series_policy.inc.
namespace {
constexpr wchar_t kNativeMediaTverPlaybackWatchdogPolicyScript[] = LR"JS(
(() => {
  if (location.hostname !== 'tver.jp' ||
      !location.pathname.startsWith('/episodes/')) return null;

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
      (element.getAttribute('data-testid') || '') + ' ' +
      (element.textContent || ''));
  const point = element => {
    if (!visible(element) || window.innerWidth <= 0 || window.innerHeight <= 0) {
      return null;
    }
    const rect = element.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    if (centerX < 0 || centerX > window.innerWidth ||
        centerY < 0 || centerY > window.innerHeight) return null;
    return [
      Math.max(0, Math.min(10000, Math.round((centerX / window.innerWidth) * 10000))),
      Math.max(0, Math.min(10000, Math.round((centerY / window.innerHeight) * 10000)))
    ];
  };

  const controls = Array.from(document.querySelectorAll(
      'button, [role="button"], a, [aria-label], [title]'));

  // A survey can cover the player and must be dismissed before any playback
  // recovery or fullscreen action is attempted.
  const surveyClose = controls.find(element => {
    if (!visible(element)) return false;
    const label = labelOf(element);
    if (!/(?:閉じる|とじる|close|dismiss)/i.test(label)) return false;
    let scope = element;
    for (let depth = 0; scope && depth < 10;
         ++depth, scope = scope.parentElement) {
      if (/(?:アンケート|ご回答|回答する|誕生年|誕生月|性別)/.test(
          normalize(scope.textContent))) return true;
    }
    const dialog = element.closest('[role="dialog"], [aria-modal="true"]');
    return !!dialog &&
        /(?:アンケート|ご回答|回答する|誕生年|誕生月|性別)/.test(
            normalize(dialog.textContent));
  });
  if (surveyClose) return point(surveyClose);

  const state = window.__homePanelSakuraMeetsState;
  if (state && state.restartRequested) return 'restart';
  if ((state && state.adActive) || window.__homePanelTverAdActive) return null;

  const video = Array.from(document.querySelectorAll('video')).find(visible) || null;
  const playButton = controls.find(element => {
    if (!visible(element) || !element.matches('button, [role="button"]')) return false;
    const label = labelOf(element).toLowerCase();
    if (/(?:一時停止|pause)/i.test(label)) return false;
    return /(?:^|\s)(?:動画を)?再生(?:する)?(?:\s|$)/.test(label) ||
           /(?:^|\s)play(?: video)?(?:\s|$)/i.test(label);
  }) || null;

  // Programmatic click()/play() can be rejected by TVer because playback needs
  // a user gesture. The host converts the returned point into trusted CDP input.
  if (!video || (video.paused && !video.ended)) {
    if (playButton) return point(playButton);
    if (video) return point(video);
    return null;
  }

  // Playback recovery takes precedence over fullscreen. Once stable playback is
  // confirmed, enter fullscreen only when the legacy loop marks it dirty.
  if (state && state.fullscreenDirty === false) return null;
  const fullscreen = document.fullscreenElement || document.webkitFullscreenElement ||
      document.msFullscreenElement || controls.some(element => {
        if (!visible(element)) return false;
        const label = labelOf(element).toLowerCase();
        return /全画面を終了|全画面解除|フルスクリーンを終了/.test(label) ||
               label.includes('exit fullscreen');
      });
  if (fullscreen) {
    if (state) state.fullscreenDirty = false;
    return null;
  }
  const fullscreenButton = controls.find(element => {
    if (!visible(element)) return false;
    const label = labelOf(element).toLowerCase();
    if (/終了|解除/.test(label) || label.includes('exit fullscreen')) return false;
    return /全画面|フルスクリーン/.test(label) || label.includes('fullscreen');
  });
  return fullscreenButton ? point(fullscreenButton) : null;
})()
)JS";
}  // namespace
