// Unified YouTube runtime: event wakeups, trusted controls and recovery policy.
namespace {
constexpr wchar_t kNativeMediaYoutubeControlRecoveryScript[] = LR"JS(
(() => {
  if (!/^(www\.)?youtube\.com$/.test(location.hostname) ||
      !location.pathname.startsWith('/watch')) return null;

  const state = window.__homePanelYoutubeRuntime ||
      (window.__homePanelYoutubeRuntime = {});
  const postWake = () => {
    try { window.chrome?.webview?.postMessage('homepanel:youtube-wake'); }
    catch (_) {}
  };
  const wake = (delay = 80) => {
    clearTimeout(state.wakeTimer);
    state.wakeTimer = setTimeout(postWake, delay);
  };
  const recheck = () => wake(2000);

  const player = document.querySelector('#movie_player');
  if (!player) {
    recheck();
    return 'recovery';
  }

  const valid = element => Boolean(
      element?.isConnected && !element.disabled &&
      element.getAttribute?.('aria-disabled') !== 'true');
  const text = element => (
      element?.getAttribute?.('aria-label') ||
      element?.getAttribute?.('title') || element?.textContent || '')
      .replace(/\s+/g, ' ').trim();
  const ad = () => player.classList.contains('ad-showing') ||
      player.classList.contains('ad-interrupting');
  const fullscreen = () => Boolean(
      document.fullscreenElement || player.classList.contains('ytp-fullscreen'));
  const surveySelector =
      '.ytp-ad-survey,.ytp-ad-feedback-dialog,yt-survey-renderer,ytd-survey-renderer';

  const arm = (element, action, cooldownMs) => {
    const now = Date.now();
    if (!valid(element) ||
        (state.action === action && now - Number(state.actionAt || 0) < cooldownMs)) {
      return null;
    }
    state.actionCleanup?.();
    state.action = action;
    state.actionAt = now;

    const css = element.style.cssText;
    const hidden = element.getAttribute('aria-hidden');
    let timer = 0;
    const cleanup = () => {
      clearTimeout(timer);
      element.removeEventListener('click', onClick, true);
      if (element.isConnected) {
        element.style.cssText = css;
        if (hidden === null) element.removeAttribute('aria-hidden');
        else element.setAttribute('aria-hidden', hidden);
      }
      if (state.actionCleanup === cleanup) state.actionCleanup = null;
    };
    function onClick(event) {
      const video = player.querySelector('video');
      const accepted = valid(element) &&
          (action !== 'skip-ad' || ad()) &&
          (action !== 'play' || (!ad() && video?.paused && !video.ended)) &&
          (action !== 'fullscreen' || !fullscreen());
      if (!accepted) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
      setTimeout(cleanup, 0);
    }

    element.style.cssText +=
        ';position:fixed!important;left:calc(50vw - 48px)!important;'
        + 'top:calc(50vh - 48px)!important;width:96px!important;height:96px!important;'
        + 'margin:0!important;padding:0!important;transform:none!important;'
        + 'opacity:0!important;visibility:visible!important;display:block!important;'
        + 'pointer-events:auto!important;z-index:2147483647!important';
    element.removeAttribute('aria-hidden');
    element.addEventListener('click', onClick, true);
    state.actionCleanup = cleanup;
    timer = setTimeout(cleanup, 1400);
    return [5000, 5000];
  };

  const dismissMessageDialog = () => {
    const popup = document.querySelector('ytd-popup-container');
    if (!popup) return null;
    for (const root of popup.querySelectorAll(
        'tp-yt-paper-dialog[opened],[role="dialog"]:not([aria-hidden="true"]),'
        + 'yt-confirm-dialog-renderer,ytd-confirm-dialog-renderer')) {
      if (!root.getClientRects().length || root.matches(surveySelector) ||
          root.querySelector(surveySelector)) continue;
      const close = Array.from(root.querySelectorAll(
          'button,tp-yt-paper-button,[role="button"],[aria-label],[title]'))
          .find(element => element.getClientRects().length &&
              /^(閉じる|close)$/i.test(text(element)));
      if (close) return arm(close, 'dialog-close', 500);
    }
    return null;
  };

  const bindVideo = () => {
    const video = player.querySelector('video');
    if (!video || state.video === video) return;
    state.videoAbort?.abort();
    state.videoAbort = new AbortController();
    state.video = video;
    const handler = event => wake(
        event.type === 'waiting' || event.type === 'stalled' ? 0 : 80);
    for (const name of ['playing', 'pause', 'waiting', 'stalled', 'ended', 'error']) {
      video.addEventListener(name, handler, {
        passive: true, signal: state.videoAbort.signal
      });
    }
    wake(0);
  };
)JS" LR"JS(

  if (state.player !== player) {
    state.pageAbort?.abort();
    state.videoAbort?.abort();
    state.classObserver?.disconnect();
    state.popupObserver?.disconnect();
    state.actionCleanup?.();
    state.player = player;
    state.video = null;
    state.pageAbort = new AbortController();
    state.classObserver = new MutationObserver(() => wake());
    state.classObserver.observe(player, {
      attributes: true, attributeFilter: ['class']
    });
    const pageState = () => {
      bindVideo();
      wake(0);
    };
    for (const name of ['yt-navigate-finish', 'yt-page-data-updated',
                        'fullscreenchange']) {
      document.addEventListener(name, pageState, {
        capture: true, signal: state.pageAbort.signal
      });
    }
    const popup = document.querySelector('ytd-popup-container');
    if (popup) {
      state.popupObserver = new MutationObserver(() => wake(0));
      state.popupObserver.observe(popup, { childList: true, subtree: true });
    }
  }
  bindVideo();
  const dialogAction = dismissMessageDialog();
  if (dialogAction) return dialogAction;

  const video = player.querySelector('video');
  if (video?.error || player.classList.contains('ytp-error')) return 'reload';

  const now = Date.now();
  const fullscreenSettleMs = 1500;
  const armFullscreen = () => {
    const target = player.querySelector('.ytp-fullscreen-button');
    return arm(target, 'fullscreen', 1200);
  };

  if (ad()) {
    if (!state.adActive) {
      state.adActive = true;
      state.adFullscreenReadyAt = now + fullscreenSettleMs;
    }
    const submitPattern = /^(送信|回答を送信|submit|send)$/i;
    for (const root of player.querySelectorAll(`${surveySelector},[role="dialog"]`)) {
      if (!valid(root)) continue;
      const controls = Array.from(root.querySelectorAll(
          'button,tp-yt-paper-button,[role="button"],[role="radio"]'))
          .filter(valid);
      const submit = controls.find(element => submitPattern.test(text(element)));
      const option = controls.find(element => element !== submit &&
          !/^(閉じる|キャンセル|cancel|close|skip|スキップ)$/i.test(text(element)));
      if (submit && option) {
        if (!state.surveySelected) {
          state.surveySelected = true;
          return arm(option, 'survey-option', 500);
        }
        state.surveySelected = false;
        return arm(submit, 'survey-submit', 500);
      }
    }

    if (!fullscreen() && now >= state.adFullscreenReadyAt) {
      const action = armFullscreen();
      if (action) return action;
    }

    const skipSelector =
        '.ytp-ad-skip-button,.ytp-ad-skip-button-modern,.ytp-skip-ad-button,'
        + '.videoAdUiSkipButton,[class*="ytp-ad-skip"],[aria-label*="Skip ad" i],'
        + '[aria-label*="広告をスキップ"],[aria-label*="広告を飛ばす"]';
    const target = Array.from(player.querySelectorAll(skipSelector)).find(valid) || null;
    if (target) return arm(target, 'skip-ad', 600);
    recheck();
    return 'recovery';
  }
  state.adActive = false;
  state.surveySelected = false;

  const url = new URL(location.href);
  const videoKey = url.searchParams.get('v') || video?.currentSrc || '';
  const playlistId = url.searchParams.get('list') || '';
  if (state.videoKey !== videoKey) {
    Object.assign(state, {
      videoKey, qualityApplied: false, captionsApplied: false,
      fullscreenApplied: false, fullscreenReadyAt: now + fullscreenSettleMs,
      pausedSince: 0, lastCurrentTime: -1, lastProgressAt: now, nextRequestedAt: 0
    });
  }

  const currentTime = Number(video?.currentTime);
  if (Number.isFinite(currentTime)) {
    if (state.lastCurrentTime < 0 || currentTime > state.lastCurrentTime + 0.25 ||
        currentTime + 2 < state.lastCurrentTime) {
      state.lastProgressAt = now;
      state.nextRequestedAt = 0;
    }
    state.lastCurrentTime = currentTime;
  }

  const advance = () => {
    if (now - state.nextRequestedAt < 8000) {
      recheck();
      return 'recovery';
    }
    state.nextRequestedAt = now;
    const candidate = new URL(
        player.querySelector('.ytp-next-button[href]')?.href || location.href);
    if (candidate.pathname === '/watch' && candidate.searchParams.get('v') &&
        candidate.searchParams.get('list') === playlistId &&
        candidate.href !== location.href) {
      location.assign(candidate.href);
      return 'recovery';
    }
    try {
      if (typeof player.nextVideo === 'function') {
        player.nextVideo();
        recheck();
        return 'recovery';
      }
    } catch (_) {}
    return arm(player.querySelector('.ytp-next-button'), 'next', 3000) || 'reload';
  };

  if (video?.ended) return advance();
  if (video?.paused && !video.ended) {
    if (!state.pausedSince) state.pausedSince = now;
    try { video.play()?.catch?.(() => {}); } catch (_) {}
    const action = arm(player.querySelector('.ytp-play-button'), 'play', 1500);
    if (action) return action;
    if (now - state.pausedSince >= 10 * 1000) return advance();
    recheck();
    return 'recovery';
  }

  if (video) {
    state.pausedSince = 0;
    if (now - state.lastProgressAt >= 30 * 1000) return advance();
  }

  if (!state.qualityApplied) {
    const preferredQuality = 'medium';
    let applied = false;
    try {
      if (typeof player.setPlaybackQualityRange === 'function') {
        player.setPlaybackQualityRange(preferredQuality, preferredQuality);
        applied = true;
      }
      if (typeof player.setPlaybackQuality === 'function') {
        player.setPlaybackQuality(preferredQuality);
        applied = true;
      }
    } catch (_) {}
    state.qualityApplied = applied;
  }

  if (!state.captionsApplied) {
    const captions = player.querySelector('.ytp-subtitles-button');
    if (captions?.getAttribute('aria-pressed') === 'true') {
      return arm(captions, 'captions-off', 800) || 'recovery';
    }
    try {
      if (typeof player.setOption === 'function') player.setOption('captions', 'track', {});
      state.captionsApplied = true;
    } catch (_) {}
  }

  if (fullscreen()) {
    state.fullscreenApplied = true;
    return null;
  }
  if (state.fullscreenApplied) return null;
  if (now < state.fullscreenReadyAt) {
    recheck();
    return 'recovery';
  }
  return armFullscreen();
})()
)JS";
}  // namespace
