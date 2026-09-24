LR"JS(
(() => {
  if (location.hostname !== 'tver.jp' ||
      !location.pathname.startsWith('/episodes/')) return null;

  const state = window.__homePanelTverRuntime ||
      (window.__homePanelTverRuntime = {});
  const post = message => {
    try { window.chrome?.webview?.postMessage(message); }
    catch (_) {}
  };
  const wake = (delay = 80) => {
    clearTimeout(state.wakeTimer);
    state.wakeTimer = setTimeout(() => post('homepanel:tver-wake'), delay);
  };
  const recheck = () => wake(2000);
  const now = Date.now();

  const valid = element => Boolean(
      element?.isConnected && !element.disabled &&
      element.getAttribute?.('aria-disabled') !== 'true');
  const text = element => (
      element?.getAttribute?.('aria-label') ||
      element?.getAttribute?.('title') ||
      element?.getAttribute?.('data-testid') ||
      element?.textContent || '')
      .replace(/\s+/g, ' ').trim();
  const visible = element => {
    if (!valid(element)) return false;
    for (let node = element; node && node !== document.body;
         node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden' ||
          Number(style.opacity) <= 0.05 ||
          node.getAttribute?.('aria-hidden') === 'true') return false;
    }
    const rect = element.getBoundingClientRect?.();
    return Boolean(rect && rect.width > 0 && rect.height > 0);
  };

  const videos = Array.from(document.querySelectorAll('video'));
  const video = videos.find(visible) || videos[0] || null;

  // TVer requires an answered questionnaire before playback. Closing it
  // returns to the poster and the next Play click opens it again. Keep the
  // player below the dialog and let the viewer complete the form.
  const questionnaire = Array.from(document.querySelectorAll('[role="dialog"]'))
      .find(dialog => dialog.querySelector('form[id^="questionnaire-"]') ||
          /アンケート/.test(dialog.getAttribute('aria-label') || '') ||
          /アンケート/.test(dialog.textContent || ''));
  if (questionnaire) {
    state.viewportPlayer?.removeAttribute?.('data-homepanel-tver-fill');
    for (const ancestor of state.viewportAncestors || []) {
      ancestor.removeAttribute?.('data-homepanel-tver-fill-ancestor');
    }
    state.viewportPlayer = null;
    state.viewportAncestors = [];
    if (!state.mediaInitSent) {
      state.mediaInitSent = true;
      post('homepanel:tver-media-init');
    }
    const form = questionnaire.querySelector('form[id^="questionnaire-"]');
    const storageKey = 'homepanel:tver:questionnaire:v1';
    const readFields = () => {
      const year = form?.querySelector('[name="birthYear"]')?.value || '';
      const month = form?.querySelector('[name="birthMonth"]')?.value || '';
      const postCode = form?.querySelector('[name="postCode"]')?.value || '';
      const genderCode = form?.querySelector('[role="radio"][aria-checked="true"]')
          ?.getAttribute('value') || '';
      return { year, month, postCode, genderCode };
    };
    const validFields = fields => fields &&
        /^\d{4}$/.test(fields.year) && Number(fields.year) >= 1900 &&
        Number(fields.year) <= new Date().getFullYear() &&
        /^(?:0?[1-9]|1[0-2])$/.test(fields.month) &&
        /^\d{7}$/.test(fields.postCode) &&
        ['1','2','9'].includes(fields.genderCode);
    if (form && state.questionnaireCaptureForm !== form) {
      state.questionnaireCaptureForm = form;
      state.questionnaireFilledForm = null;
      state.questionnaireSubmitCount = 0;
      form.addEventListener('submit', () => {
        const fields = readFields();
        if (validFields(fields)) {
          try { localStorage.setItem(storageKey, JSON.stringify(fields)); }
          catch (_) {}
        }
      }, true);
    }
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(storageKey) || 'null'); }
    catch (_) {}
    if (form && validFields(saved)) {
      if (state.questionnaireFilledForm !== form) {
        for (const [name, value] of [
          ['birthYear', saved.year], ['birthMonth', saved.month],
          ['postCode', saved.postCode]
        ]) {
          const input = form.querySelector(`[name="${name}"]`);
          if (!input) continue;
          const setter = Object.getOwnPropertyDescriptor(
              HTMLInputElement.prototype, 'value')?.set;
          if (setter) setter.call(input, value);
          else input.value = value;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
        }
        state.questionnaireFilledForm = form;
        state.questionnaireFilledAt = Date.now();
        wake(350);
        return 'recovery';
      }
      const fields = readFields();
      if (fields.genderCode !== saved.genderCode) {
        const gender = Array.from(form.querySelectorAll('[role="radio"]'))
            .find(option => option.getAttribute('value') === saved.genderCode);
        const rect = gender?.getBoundingClientRect();
        const x = rect && rect.left + rect.width / 2;
        const y = rect && rect.top + rect.height / 2;
        if (rect?.width > 0 && rect.height > 0 &&
            x >= 0 && y >= 0 && x < innerWidth && y < innerHeight &&
            (!state.questionnaireLastGenderClickAt ||
             Date.now() - state.questionnaireLastGenderClickAt >= 1000)) {
          state.questionnaireLastGenderClickAt = Date.now();
          return [x, y];
        }
        recheck();
        return 'recovery';
      }
      const submit = Array.from(questionnaire.querySelectorAll('button[type="submit"][form]'))
          .find(button => button.getAttribute('form') === form.id);
      const rect = submit?.getBoundingClientRect();
      const x = rect && rect.left + rect.width / 2;
      const y = rect && rect.top + rect.height / 2;
      if (validFields(fields) && fields.year === saved.year &&
          fields.month === saved.month && fields.postCode === saved.postCode &&
          fields.genderCode === saved.genderCode && submit && !submit.disabled &&
          rect.width > 0 && rect.height > 0 &&
          x >= 0 && y >= 0 && x < innerWidth && y < innerHeight &&
          Date.now() - state.questionnaireFilledAt >= 300 &&
          (!state.questionnaireLastSubmitAt ||
           Date.now() - state.questionnaireLastSubmitAt >= 2000) &&
          state.questionnaireSubmitCount < 3) {
        state.questionnaireLastSubmitAt = Date.now();
        state.questionnaireSubmitCount++;
        return [x, y];
      }
    }
    recheck();
    return 'recovery';
  }
)JS" LR"JS(

  // The episode poster's Play button is a sibling of the Video.js player.
  // Start TVer's own playback flow before placing the player above the page.
  const posterPlay = document.getElementById?.('episode-play');
  if (visible(posterPlay)) {
    state.viewportPlayer?.removeAttribute?.('data-homepanel-tver-fill');
    for (const ancestor of state.viewportAncestors || []) {
      ancestor.removeAttribute?.('data-homepanel-tver-fill-ancestor');
    }
    state.viewportPlayer = null;
    state.viewportAncestors = [];
    if (!state.mediaInitSent) {
      state.mediaInitSent = true;
      post('homepanel:tver-media-init');
    }
    const rect = posterPlay.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    if (x >= 0 && y >= 0 && x < innerWidth && y < innerHeight &&
        (!state.posterLastClickAt || now - state.posterLastClickAt >= 2000)) {
      state.posterLastClickAt = now;
      return [x, y];
    }
    recheck();
    return 'recovery';
  }
  if (!video) {
    recheck();
    return 'recovery';
  }

  const player = video.closest(
      '[data-testid*="player" i],[class*="player" i],[id*="player" i]') ||
      video.parentElement || video;
  // Fill the WebView even when Chromium rejects browser fullscreen while the
  // native panel is behind another window. Keep the controls in the player.
  if (document.createElement && (document.head || document.documentElement)) {
    if (!document.getElementById('homepanel-tver-viewport-fill')) {
      const style = document.createElement('style');
      style.id = 'homepanel-tver-viewport-fill';
      style.textContent = `
        [data-homepanel-tver-fill-ancestor] {
          transform:none !important; contain:none !important;
          filter:none !important; overflow:visible !important;
        }
        [data-homepanel-tver-fill] {
          position:fixed !important; inset:0 !important;
          width:100vw !important; height:100vh !important;
          max-width:none !important; max-height:none !important;
          z-index:2147483000 !important; background:#000 !important;
        }
        [data-homepanel-tver-fill] video {
          width:100% !important; height:100% !important;
          object-fit:contain !important;
        }
      `;
      (document.head || document.documentElement).appendChild(style);
    }
    const previous = state.viewportPlayer;
    if (previous !== player) {
      previous?.removeAttribute?.('data-homepanel-tver-fill');
      for (const ancestor of state.viewportAncestors || []) {
        ancestor.removeAttribute?.('data-homepanel-tver-fill-ancestor');
      }
      state.viewportPlayer = player;
      state.viewportAncestors = [];
      player.setAttribute?.('data-homepanel-tver-fill', '');
      for (let ancestor = player.parentElement;
           ancestor && ancestor !== document.body;
           ancestor = ancestor.parentElement) {
        ancestor.setAttribute?.('data-homepanel-tver-fill-ancestor', '');
        state.viewportAncestors.push(ancestor);
      }
    }
  }
  const fullscreen = () => Boolean(
      document.fullscreenElement || document.webkitFullscreenElement ||
      document.msFullscreenElement);
  const mediaKey = () => (video.currentSrc || video.src || '').trim();
  const duration = () => Number.isFinite(video.duration) && video.duration > 0
      ? video.duration : 0;
  const currentTime = () => Number.isFinite(video.currentTime) && video.currentTime >= 0
      ? video.currentTime : 0;

  const lockedEpisodePath = state.lockedEpisodePath || location.pathname;
  state.lockedEpisodePath = lockedEpisodePath;
  const differentEpisode = value => {
    if (value == null || value === '') return false;
    try {
      const target = new URL(String(value), location.href);
      return target.origin === location.origin &&
          target.pathname.startsWith('/episodes/') &&
          target.pathname !== lockedEpisodePath;
    } catch (_) {
      return false;
    }
  };
  if (!state.routeGuardInstalled) {
    state.routeGuardInstalled = true;
    for (const methodName of ['pushState', 'replaceState']) {
      const original = history[methodName];
      if (typeof original !== 'function') continue;
      history[methodName] = function(stateValue, title, url) {
        if (differentEpisode(url)) return;
        return original.apply(this, arguments);
      };
    }
    document.addEventListener('click', event => {
      const element = event.target instanceof Element ? event.target : null;
      const anchor = element?.closest?.('a[href]');
      if (!anchor || !differentEpisode(anchor.href)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    }, true);
  }

  const controls = () => Array.from(player.querySelectorAll(
      'button,[role="button"],[role="menuitem"],[role="option"],'
      + '[role="radio"],[aria-label],[title],[data-testid]'));
  const explicitAd = () => {
    const skipPattern = /(?:広告|CM).{0,14}スキップ|^スキップ$|skip\s+(?:this\s+)?ad/i;
    if (controls().some(element => visible(element) && skipPattern.test(text(element)))) {
      return true;
    }
    const selectors = [
      '[aria-label*="広告"]','[title*="広告"]',
      '[aria-label*="CM"]','[title*="CM"]',
      '[data-testid*="advert" i]','[data-testid*="commercial" i]',
      '[class*="advert" i]','[class*="commercial" i]',
      '[id*="advert" i]','[id*="commercial" i]'
    ];
    return Array.from(player.querySelectorAll(selectors.join(','))).some(element => {
      if (!visible(element)) return false;
      const value = text(element);
      return value.length <= 180 &&
          /広告|(?:^|\s)CM(?:\s|$|[:：\d])|Advertisement|Ad break/i.test(value);
    });
  };
  const ad = () => {
    const length = duration();
    const shortMedia = length >= 5 && length <= 65;
    // TVer can reuse the same video element and retain our 1.75x setting for
    // a pre-roll. Playback rate is therefore not evidence of program media.
    return explicitAd() || shortMedia;
  };
)JS" LR"JS(

  const actionLane = action => {
    if (action === 'fullscreen') return 'fullscreen';
    if (action === 'skip-ad' || action.startsWith('survey-')) return 'ad';
    return 'control';
  };
  const actionState = action => {
    const lanes = state.actionLanes || (state.actionLanes = {});
    const key = actionLane(action);
    return lanes[key] || (lanes[key] = {});
  };
  const arm = (element, action, cooldownMs) => {
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
    const inPlayer = player.contains?.(element) || false;
    for (let node = element; node && node !== player.parentElement;
         node = node.parentElement) {
      remember(node);
      if (!inPlayer || node === player) break;
    }

    const center = () => {
      const rect = element.getBoundingClientRect?.();
      const x = Number(rect?.left) + Number(rect?.width) / 2;
      const y = Number(rect?.top) + Number(rect?.height) / 2;
      if (!rect || rect.width <= 0 || rect.height <= 0 ||
          !Number.isFinite(x) || !Number.isFinite(y) ||
          x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return null;
      return { x, y };
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

    const cleanup = () => {
      element.removeEventListener('click', onClick, true);
      for (const entry of touched.reverse()) {
        if (!entry.node.isConnected) continue;
        if (entry.pointerValue) {
          entry.node.style.setProperty(
              'pointer-events', entry.pointerValue, entry.pointerPriority);
        } else entry.node.style.removeProperty('pointer-events');
        if (entry.visibilityValue) {
          entry.node.style.setProperty(
              'visibility', entry.visibilityValue, entry.visibilityPriority);
        } else entry.node.style.removeProperty('visibility');
        if (entry.overflowValue) {
          entry.node.style.setProperty(
              'overflow', entry.overflowValue, entry.overflowPriority);
        } else entry.node.style.removeProperty('overflow');
      }
      if (element.isConnected) {
        element.style.cssText = targetCss;
        if (targetHidden === null) element.removeAttribute('aria-hidden');
        else element.setAttribute('aria-hidden', targetHidden);
      }
      if (lane.cleanup === cleanup) lane.cleanup = null;
    };
    function onClick(event) {
      const accepted = valid(element) &&
          (action !== 'skip-ad' || (visible(element) && ad())) &&
          (action !== 'play' || (!ad() && video.paused && !video.ended)) &&
          (action !== 'fullscreen' || !fullscreen());
      if (!accepted) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
      setTimeout(cleanup, 0);
    }

    if (!point) {
      cleanup();
      return null;
    }
    lane.action = action;
    lane.actionAt = now;
    element.addEventListener('click', onClick, true);
    lane.cleanup = cleanup;
    setTimeout(cleanup, 1400);
    return [point.x, point.y];
  };
)JS" LR"JS(

  const bindVideo = () => {
    if (state.video === video) return;
    if (state.video) {
      // A replacement <video> can use the same source URL. Its ended event
      // must not inherit the previous element's program confirmation.
      state.mediaKey = null;
      state.mediaInitSent = false;
      state.programPlayedSeconds = 0;
    }
    state.videoAbort?.abort();
    state.videoAbort = new AbortController();
    state.video = video;
    const handler = event => {
      if (event.type === 'timeupdate') {
        const at = currentTime();
        const delta = at - Number(state.programLastProgressTime || 0);
        if (mediaKey() === state.programKey && !video.paused && !ad() &&
            delta > 0 && delta <= 5) {
          state.programPlayedSeconds += delta;
        }
        state.programLastProgressTime = at;
        return;
      }
      if (event.type === 'ended') {
        const key = mediaKey();
        const length = duration();
        const at = currentTime();
        if (key && key === state.programKey && !ad() && length > 65 &&
            state.programStartedAt && Date.now() - state.programStartedAt >= 30000 &&
            state.programPlayedSeconds >= 60 &&
            at >= Math.max(3, length - 10)) {
          state.programEndPending = true;
        }
      }
      wake(event.type === 'waiting' || event.type === 'stalled' ? 0 : 80);
    };
    for (const name of [
      'playing','pause','waiting','stalled','ended','error',
      'loadedmetadata','durationchange','emptied','ratechange','timeupdate'
    ]) {
      video.addEventListener(name, handler, {
        passive: true, signal: state.videoAbort.signal
      });
    }
  };

  if (state.player !== player) {
    if (state.player) state.mediaKey = null;
    state.playerObserver?.disconnect();
    state.pageAbort?.abort();
    state.videoAbort?.abort();
    for (const lane of Object.values(state.actionLanes || {})) lane.cleanup?.();
    state.actionLanes = {};
    state.player = player;
    state.video = null;
    state.pageAbort = new AbortController();
    state.playerObserver = new MutationObserver(() => wake(0));
    state.playerObserver.observe(player, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class','disabled','aria-disabled','aria-hidden']
    });
    document.addEventListener('fullscreenchange', () => wake(0), {
      capture: true, signal: state.pageAbort.signal
    });
  }
  bindVideo();

  if (!state.mediaInitSent) {
    state.mediaInitSent = true;
    post('homepanel:tver-media-init');
  }

  const key = mediaKey();
  if (state.mediaKey !== key) {
    state.mediaKey = key;
    state.mediaStartedAt = now;
    state.mediaOrigin = currentTime();
    state.qualityApplied = false;
    state.qualityLastAttemptAt = 0;
    state.programEndPending = false;
    state.programCandidateKey = '';
    state.programKey = '';
    state.programStartedAt = 0;
    state.programPlayedSeconds = 0;
    state.programLastProgressTime = currentTime();
    state.fullscreenKeyRequestedAt = 0;
  }

  const adActive = ad();
  if (!adActive && key && !video.paused && !video.ended) {
    if (!state.programCandidateKey || state.programCandidateKey !== key) {
      state.programCandidateKey = key;
      state.programCandidateOrigin = currentTime();
    }
    // A short pre-roll without an ad badge must never become the program.
    if (duration() > 65 && (currentTime() >=
        Number(state.programCandidateOrigin || 0) + 1)) {
      if (state.programKey !== key) {
        state.programStartedAt = now;
        state.programPlayedSeconds = 0;
        state.programLastProgressTime = currentTime();
      }
      state.programKey = key;
    }
  }

  if (state.programEndPending && !state.endReported) {
    state.endReported = true;
    post('homepanel:tver-ended');
    return 'recovery';
  }

  const dialogs = Array.from(document.querySelectorAll(
      '[role="dialog"],[aria-modal="true"]')).filter(valid);
  for (const root of dialogs) {
    if (root.querySelector('form[id^="questionnaire-"]') ||
        /アンケート/.test(root.textContent || '')) continue;
    const close = Array.from(root.querySelectorAll(
        'button,[role="button"],[aria-label],[title]')).find(element =>
          valid(element) && /^(閉じる|とじる|close|dismiss)$/i.test(text(element)));
    if (close) {
      const action = arm(close, 'dialog-close', 500);
      if (action) return action;
    }
  }

  const fullscreenControl = () => {
    const pattern = /(全画面|フルスクリーン|fullscreen|full screen)/i;
    const exitPattern = /(終了|解除|exit fullscreen)/i;
    return controls().find(element => {
      if (!valid(element)) return false;
      const value = text(element);
      return pattern.test(value) && !exitPattern.test(value);
    }) || null;
  };
  const requestFullscreen = () => {
    if (fullscreen()) {
      state.fullscreenKeyRequestedAt = 0;
      return null;
    }
    if (!state.fullscreenKeyRequestedAt ||
        now - state.fullscreenKeyRequestedAt >= 4000) {
      state.fullscreenKeyRequestedAt = now;
      wake(1200);
      post('homepanel:tver-fullscreen-key');
      return 'recovery';
    }
    const action = arm(fullscreenControl(), 'fullscreen', 1200);
    if (action) return action;
    recheck();
    return 'recovery';
  };
)JS" LR"JS(

  if (adActive) {
    const skipPattern = /(?:広告|CM).{0,14}スキップ|^スキップ$|skip\s+(?:this\s+)?ad/i;
    const skip = controls().find(element => visible(element) &&
        skipPattern.test(text(element))) || null;
    if (skip) {
      const action = arm(skip, 'skip-ad', 600);
      if (action) return action;
    }
    if (!fullscreen()) return requestFullscreen();
    recheck();
    return 'recovery';
  }

  try {
    video.defaultPlaybackRate = 1.75;
    if (video.playbackRate !== 1.75) video.playbackRate = 1.75;
    if (video.muted) video.muted = false;
    if (video.volume !== 1.0) video.volume = 1.0;
  } catch (_) {}

  if (video.error) return 'restart';
  if (video.paused && !video.ended) {
    try { video.play()?.catch?.(() => {}); }
    catch (_) {}
    const playPattern = /^(再生|play)$/i;
    const play = controls().find(element => valid(element) &&
        playPattern.test(text(element))) || null;
    const action = arm(play, 'play', 1200);
    if (action) return action;
    recheck();
    return 'recovery';
  }

  if (!state.qualityApplied) {
    const candidates = controls().filter(valid);
    // TVer may portal menu options outside the video's nearest player node.
    const portalOptions = state.qualityLastAttemptAt ? Array.from(
      document.querySelectorAll(
        '[role="menu"] [role="menuitem"], [role="menu"] [role="radio"], '
        + '[role="dialog"] [role="option"], [role="listbox"] [role="option"]')) : [];
    const low = [...candidates, ...portalOptions].find(element =>
      visible(element) &&
      /^(低|低画質|low)(?:[（(](?:選択中|設定中)[）)])?$/i
        .test(text(element).trim())) || null;
    if (low) {
      const selected = low.getAttribute('aria-checked') === 'true' ||
          low.getAttribute('aria-selected') === 'true' ||
          low.getAttribute('data-state') === 'checked' ||
          /選択中|設定中/.test(text(low));
      if (selected) state.qualityApplied = true;
      else {
        const action = arm(low, 'quality-low', 700);
        if (action) return action;
      }
    } else {
      const menu = candidates.find(element =>
        /^(画質|画質設定|設定|quality|quality settings|settings)$/i
          .test(text(element))) || null;
      if (menu && (!state.qualityLastAttemptAt ||
                   now - state.qualityLastAttemptAt >= 1200)) {
        const action = arm(menu, 'quality-menu', 700);
        if (action) {
          state.qualityLastAttemptAt = now;
          return action;
        }
      }
    }
  }

  // Browser fullscreen can be refused in a background WebView. Keep applying
  // program settings and checking quality while fullscreen retries continue.
  if (!state.qualityApplied) recheck();
  if (!fullscreen()) return requestFullscreen();

  return null;
})()
)JS"
