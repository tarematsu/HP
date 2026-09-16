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
      document.fullscreenElement || document.webkitFullscreenElement ||
      document.msFullscreenElement || player.classList.contains('ytp-fullscreen'));
  const surveySelector =
      '.ytp-ad-survey,.ytp-ad-feedback-dialog,yt-survey-renderer,ytd-survey-renderer';
)JS" LR"JS(

  const actionLane = action => {
    if (action === 'skip-ad' || action.startsWith('survey-')) return 'ad';
    return 'control';
  };
  const actionState = action => {
    const lanes = state.actionLanes || (state.actionLanes = {});
    const key = actionLane(action);
    return lanes[key] || (lanes[key] = {});
  };

  const arm = (element, action, cooldownMs) => {
    const now = Date.now();
    const lane = actionState(action);
    if (!valid(element) ||
        (lane.action === action && now - Number(lane.actionAt || 0) < cooldownMs)) {
      return null;
    }
    lane.cleanup?.();

    const targetCss = element.style.cssText;
    const targetHidden = element.getAttribute('aria-hidden');
    const touched = [];
    const remember = node => {
      if (!node?.style) return;
      touched.push({
        node,
        pointerValue: node.style.getPropertyValue('pointer-events'),
        pointerPriority: node.style.getPropertyPriority('pointer-events'),
        visibilityValue: node.style.getPropertyValue('visibility'),
        visibilityPriority: node.style.getPropertyPriority('visibility'),
        overflowValue: node.style.getPropertyValue('overflow'),
        overflowPriority: node.style.getPropertyPriority('overflow')
      });
      node.style.setProperty('pointer-events', 'auto', 'important');
      node.style.setProperty('overflow', 'visible', 'important');
      if (getComputedStyle(node).visibility === 'hidden') {
        node.style.setProperty('visibility', 'visible', 'important');
      }
    };
    for (let node = element; node && node !== player.parentElement;
         node = node.parentElement) {
      remember(node);
      if (node === player) break;
    }

    const center = () => {
      const rect = element.getBoundingClientRect?.();
      const x = Number(rect?.left) + Number(rect?.width) / 2;
      const y = Number(rect?.top) + Number(rect?.height) / 2;
      if (!rect || rect.width <= 0 || rect.height <= 0 ||
          !Number.isFinite(x) || !Number.isFinite(y) ||
          x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight) {
        return null;
      }
      return { rect, x, y };
    };
    const hitOwnControl = point => {
      if (!point) return false;
      const hit = document.elementFromPoint(point.x, point.y);
      return Boolean(hit && (hit === element || element.contains(hit)));
    };

    let point = center();
    if (!hitOwnControl(point)) {
      element.style.cssText +=
          ';position:fixed!important;left:calc(50vw - 48px)!important;'
          + 'top:calc(50vh - 48px)!important;width:96px!important;height:96px!important;'
          + 'margin:0!important;padding:0!important;transform:none!important;'
          + 'opacity:0.001!important;visibility:visible!important;display:block!important;'
          + 'pointer-events:auto!important;z-index:2147483647!important';
      element.removeAttribute('aria-hidden');
      point = center();
    }
    if (!point) {
      for (const entry of touched.reverse()) {
        if (entry.pointerValue) {
          entry.node.style.setProperty(
              'pointer-events', entry.pointerValue, entry.pointerPriority);
        } else {
          entry.node.style.removeProperty('pointer-events');
        }
        if (entry.visibilityValue) {
          entry.node.style.setProperty(
              'visibility', entry.visibilityValue, entry.visibilityPriority);
        } else {
          entry.node.style.removeProperty('visibility');
        }
        if (entry.overflowValue) {
          entry.node.style.setProperty(
              'overflow', entry.overflowValue, entry.overflowPriority);
        } else {
          entry.node.style.removeProperty('overflow');
        }
      }
      element.style.cssText = targetCss;
      if (targetHidden === null) element.removeAttribute('aria-hidden');
      else element.setAttribute('aria-hidden', targetHidden);
      return null;
    }

    lane.action = action;
    lane.actionAt = now;
    let timer = 0;
    const cleanup = () => {
      clearTimeout(timer);
      element.removeEventListener('click', onClick, true);
      for (const entry of touched.reverse()) {
        if (!entry.node.isConnected) continue;
        if (entry.pointerValue) {
          entry.node.style.setProperty(
              'pointer-events', entry.pointerValue, entry.pointerPriority);
        } else {
          entry.node.style.removeProperty('pointer-events');
        }
        if (entry.visibilityValue) {
          entry.node.style.setProperty(
              'visibility', entry.visibilityValue, entry.visibilityPriority);
        } else {
          entry.node.style.removeProperty('visibility');
        }
        if (entry.overflowValue) {
          entry.node.style.setProperty(
              'overflow', entry.overflowValue, entry.overflowPriority);
        } else {
          entry.node.style.removeProperty('overflow');
        }
      }
      if (element.isConnected) {
        element.style.cssText = targetCss;
        if (targetHidden === null) element.removeAttribute('aria-hidden');
        else element.setAttribute('aria-hidden', targetHidden);
      }
      if (lane.cleanup === cleanup) lane.cleanup = null;
    };
    function onClick(event) {
      const video = player.querySelector('video');
      const accepted = valid(element) &&
          (action !== 'skip-ad' || ad()) &&
          (action !== 'play' || (!ad() && video?.paused && !video.ended));
      if (!accepted) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
      setTimeout(cleanup, 0);
    }

    element.addEventListener('click', onClick, true);
    lane.cleanup = cleanup;
    timer = setTimeout(cleanup, 1400);
    return [point.x, point.y];
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
    for (const name of ['loadedmetadata', 'loadeddata', 'canplay', 'playing',
                        'pause', 'waiting', 'stalled', 'ended', 'error']) {
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
    for (const lane of Object.values(state.actionLanes || {})) lane.cleanup?.();
    state.actionLanes = {};
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
  const url = new URL(location.href);
  const videoKey = url.searchParams.get('v') || video?.currentSrc || '';
  const playlistId = url.searchParams.get('list') || '';
  if (state.videoKey !== videoKey) {
    Object.assign(state, {
      videoKey, qualityApplied: false, captionsApplied: false,
      fullscreenApplied: false,
      pausedSince: 0, lastCurrentTime: -1, lastProgressAt: now, nextRequestedAt: 0
    });
  }

  const videoFullscreenPoint = media => {
    if (!(media instanceof HTMLMediaElement) ||
        media.readyState < HTMLMediaElement.HAVE_METADATA ||
        window.innerWidth <= 0 || window.innerHeight <= 0) return null;
    const rect = media.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const insetX = Math.min(24, Math.max(8, rect.width / 8));
    const insetY = Math.min(24, Math.max(8, rect.height / 8));
    const x = rect.right - insetX;
    const y = rect.bottom - insetY;
    if (x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight)
      return null;
    return [x, y];
  };

  state.fullscreenApplied = fullscreen();
  if (!state.fullscreenApplied) {
    const fullscreenPoint = videoFullscreenPoint(video);
    if (fullscreenPoint) {
      wake(1200);
      return fullscreenPoint;
    }
    recheck();
    return 'recovery';
  }

  if (ad()) {
    state.adActive = true;
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

  return null;
})()
)JS";
}  // namespace