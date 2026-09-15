// Minimal YouTube event bridge. It reports only state transitions that can change
// recovery decisions; the recovery script owns all policy.
namespace {
constexpr wchar_t kNativeMediaYoutubeEventAgentScript[] = LR"JS(
(() => {
  if (!/^(www\.)?youtube\.com$/.test(location.hostname) ||
      !location.pathname.startsWith('/watch')) return null;
  const player = document.querySelector('#movie_player');
  if (!player) return null;

  const old = window.__homePanelYoutubeEventAgent;
  if (old?.player === player) return true;
  old?.dispose?.();

  const state = {
    player, video: null, pageAbort: new AbortController(), videoAbort: null,
    classObserver: null, popupObserver: null, wakeTimer: 0, recoveryTimer: 0
  };
  window.__homePanelYoutubeEventAgent = state;

  const postWake = () => {
    state.wakeTimer = 0;
    try { window.chrome?.webview?.postMessage('homepanel:youtube-wake'); }
    catch (_) {}
  };
  const wake = (delay = 80) => {
    clearTimeout(state.wakeTimer);
    state.wakeTimer = setTimeout(postWake, delay);
  };
  state.scheduleRecoveryWake = delay => {
    clearTimeout(state.recoveryTimer);
    state.recoveryTimer = setTimeout(() => {
      state.recoveryTimer = 0;
      postWake();
    }, delay);
  };

  const surveySelector =
      '.ytp-ad-survey,.ytp-ad-feedback-dialog,yt-survey-renderer,ytd-survey-renderer';
  const closePattern = /^(閉じる|close)$/i;
  const dismissMessageDialog = () => {
    const popup = document.querySelector('ytd-popup-container');
    if (!popup) return;
    for (const root of popup.querySelectorAll(
        'tp-yt-paper-dialog[opened],[role="dialog"]:not([aria-hidden="true"]),'
        + 'yt-confirm-dialog-renderer,ytd-confirm-dialog-renderer')) {
      if (!root.getClientRects().length || root.matches(surveySelector) ||
          root.querySelector(surveySelector)) continue;
      const close = Array.from(root.querySelectorAll(
          'button,tp-yt-paper-button,[role="button"],[aria-label],[title]'))
          .find(element => element.getClientRects().length &&
              closePattern.test((element.getAttribute('aria-label') ||
                  element.getAttribute('title') || element.textContent || '').trim()));
      if (!close) continue;
      try { close.click(); } catch (_) {}
      return;
    }
  };

  const bindVideo = () => {
    const video = player.querySelector('video');
    if (!video || state.video === video) return;
    state.videoAbort?.abort();
    state.videoAbort = new AbortController();
    state.video = video;
    const handler = event => {
      if (event.type === 'pause') {
        state.scheduleRecoveryWake(10 * 1000 + 500);
      } else if (event.type === 'waiting' || event.type === 'stalled') {
        state.scheduleRecoveryWake(30 * 1000 + 500);
      } else if (/^(play|playing|ended|error)$/.test(event.type)) {
        clearTimeout(state.recoveryTimer);
        state.recoveryTimer = 0;
      }
      wake(event.type === 'waiting' || event.type === 'stalled' ? 0 : 80);
    };
    for (const name of [
        'play', 'playing', 'pause', 'waiting', 'stalled', 'ended', 'error',
        'loadedmetadata']) {
      video.addEventListener(name, handler, {
        passive: true, signal: state.videoAbort.signal
      });
    }
    wake(0);
  };

  const onPageState = () => {
    bindVideo();
    dismissMessageDialog();
    wake(0);
  };
  for (const name of ['yt-navigate-finish', 'yt-page-data-updated']) {
    document.addEventListener(name, onPageState, {
      capture: true, signal: state.pageAbort.signal
    });
  }
  for (const name of ['fullscreenchange', 'webkitfullscreenchange']) {
    document.addEventListener(name, () => wake(0), {
      capture: true, signal: state.pageAbort.signal
    });
  }

  if (typeof MutationObserver === 'function') {
    state.classObserver = new MutationObserver(() => wake());
    state.classObserver.observe(player, {
      attributes: true, attributeFilter: ['class']
    });
    const popup = document.querySelector('ytd-popup-container');
    if (popup) {
      state.popupObserver = new MutationObserver(() => {
        dismissMessageDialog();
        wake(0);
      });
      state.popupObserver.observe(popup, { childList: true, subtree: true });
    }
  }

  state.dispose = () => {
    state.pageAbort.abort();
    state.videoAbort?.abort();
    state.classObserver?.disconnect();
    state.popupObserver?.disconnect();
    clearTimeout(state.wakeTimer);
    clearTimeout(state.recoveryTimer);
  };
  bindVideo();
  dismissMessageDialog();
  wake(0);
  return true;
})()
)JS";
}  // namespace
