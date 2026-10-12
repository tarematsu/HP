LR"JS(
(() => {
  if (location.hostname !== 'tver.jp' ||
      !location.pathname.startsWith('/episodes/')) return;

  const state = window.__homePanelTverRuntime ||
      (window.__homePanelTverRuntime = {});
  const now = Date.now();
  const post = message => {
    try { window.chrome?.webview?.postMessage(message); }
    catch (_) {}
  };
  const schedule = (delay = 700) => {
    clearTimeout(state.currentSettingsWakeTimer);
    state.currentSettingsWakeTimer = setTimeout(
        () => post('homepanel:tver-wake'), delay);
  };
  const connected = element => Boolean(
      element?.isConnected && !element.disabled &&
      element.getAttribute?.('aria-disabled') !== 'true');
  const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
  // innerText can force synchronous layout on every probed control. Text
  // content and attributes are cheaper; use a deliberately broad prefilter so
  // all speed, quality, selection and ad/skip labels still take the full path.
  const settingLabelHint =
      /広告|CM|skip|スキップ|\d|[低高中]|自動|画質|選択中|設定中|selected/i;
  const labels = element => {
    const aria = element?.getAttribute?.('aria-label');
    const title = element?.getAttribute?.('title');
    const content = element?.textContent;
    const testId = element?.getAttribute?.('data-testid');
    // When textContent is unavailable, retain the old innerText fallback.
    // Otherwise unrelated DOM nodes need no rendered-text/layout read.
    const maybeRelevant = content == null ||
        settingLabelHint.test(aria || '') ||
        settingLabelHint.test(title || '') ||
        settingLabelHint.test(content) ||
        settingLabelHint.test(testId || '');
    if (!maybeRelevant) return [];
    const values = [];
    for (const raw of [
      aria, title, element?.innerText, content, testId
    ]) {
      const value = clean(raw);
      if (value) values.push(value);
    }
    return values;
  };
  const selected = element => Boolean(element && (
      element.getAttribute?.('aria-checked') === 'true' ||
      element.getAttribute?.('aria-selected') === 'true' ||
      element.getAttribute?.('data-state') === 'checked' ||
      labels(element).some(value => /選択中|設定中|selected/i.test(value))));
  const visible = (element, knownRect = null) => {
    if (!connected(element)) return false;
    const rect = knownRect || element.getBoundingClientRect?.();
    if (!rect || rect.width <= 0 || rect.height <= 0) return false;
    try {
      const style = getComputedStyle(element);
      return style.display !== 'none' && style.visibility !== 'hidden' &&
          Number(style.opacity) > 0.05;
    } catch (_) {
      return true;
    }
  };

  // The late-September 2026 TVer redesign exposes quality as the current
  // value ("自動"/"高"/"中"/"低") and speed as "×1.0" etc. Keep these
  // current player values as the source of truth instead of relying on old
  // "画質/設定" buttons or only mutating HTMLMediaElement.playbackRate.
  const controlSelector = [
    'button', '[role="button"]', '[role="menuitem"]',
    '[role="menuitemradio"]', '[role="option"]', '[role="radio"]',
    '[aria-label]', '[title]', '[data-testid]'
  ].join(',');
  const roleContainer = element => {
    const role = element?.getAttribute?.('role') || '';
    if (/^(?:menuitem|menuitemradio|option|radio)$/i.test(role)) return true;
    try {
      return Boolean(element?.closest?.(
          '[role="menu"],[role="listbox"],[role="dialog"]'));
    } catch (_) {
      return false;
    }
  };
  const clickOnce = (element, key, cooldownMs = 900) => {
    if (!connected(element) || typeof element.click !== 'function') return false;
    const times = state.currentSettingsClickAt ||
        (state.currentSettingsClickAt = {});
    if (now - Number(times[key] || 0) < cooldownMs) return false;
    times[key] = now;
    try {
      element.click();
      schedule(280);
      return true;
    } catch (_) {
      return false;
    }
  };

  let questionnaire = false;
  for (const dialog of document.querySelectorAll('[role="dialog"]')) {
    if (dialog.querySelector?.('form[id^="questionnaire-"]') ||
        /アンケート/.test(clean(dialog.textContent))) {
      questionnaire = true;
      break;
    }
  }
  const posterPlay = document.getElementById?.('episode-play');
  if (questionnaire || visible(posterPlay)) {
    state.fullscreenCornerTapAt = now;
    schedule(900);
    return;
  }
)JS" LR"JS(

  const videoScore = video => {
    if (!video?.isConnected) return -1;
    const rect = video.getBoundingClientRect?.();
    const area = Math.max(0, Number(rect?.width) || 0) *
        Math.max(0, Number(rect?.height) || 0);
    let score = area;
    // Reuse the rectangle instead of forcing a second geometry read inside
    // visible() for every video; score each candidate only once.
    if (visible(video, rect)) score += 1000000000;
    if ((video.currentSrc || video.src || '').trim()) score += 500000000;
    if (!video.paused && !video.ended) score += 2000000000;
    if (Number(video.readyState || 0) >= 2) score += 250000000;
    return score;
  };
  let video = null;
  let bestVideoScore = -1;
  for (const candidate of document.querySelectorAll('video')) {
    const score = videoScore(candidate);
    if (score > bestVideoScore) {
      video = candidate;
      bestVideoScore = score;
    }
  }
  if (!video) {
    state.fullscreenCornerTapAt = now;
    schedule(900);
    return;
  }

  const mediaKey = (video.currentSrc || video.src || '').trim();
  if (state.currentSettingsMediaKey !== mediaKey) {
    state.currentSettingsMediaKey = mediaKey;
    state.currentSettingsClickAt = {};
    state.currentSettingsSpeedConfirmed = false;
    state.currentSettingsQualityConfirmed = false;
    state.currentSettingsFullscreenRequestAt = 0;
  }

  const duration = Number.isFinite(video.duration) && video.duration > 0
      ? video.duration : 0;
  const parseSpeed = value => {
    const compact = clean(value)
        .replace(/\s+/g, '')
        .replace(/(?:倍速|倍)$/g, '')
        .replace(/^(?:再生)?速度[:：]?/i, '');
    const match = compact.match(/^(?:×|x)?(1(?:\.0+|\.25|\.5(?:0)?|\.75))(?:選択中|設定中)?$/i);
    return match ? Number(match[1]) : null;
  };
  const parseQuality = value => {
    const compact = clean(value)
        .replace(/\s+/g, '')
        .replace(/^画質[:：]?/i, '')
        .replace(/画質$/i, '')
        .replace(/(?:選択中|設定中)$/g, '');
    return /^(?:自動|高|中|低)$/i.test(compact) ? compact : null;
  };
  // The old code scanned controls for ad markers, twice for speed and twice
  // for quality. Each filter/find could read the same innerText and trigger
  // layout again. Collect the first candidates in one semantic DOM pass.
  let speed175Option = null;
  let speedIndicator = null;
  let speedIndicatorValue = null;
  let lowOption = null;
  let qualityIndicator = null;
  let qualityIndicatorValue = null;
  let adMarker = false;
  if (duration > 65) {
    const skipPattern = /(?:広告|CM).{0,14}スキップ|skip\s+(?:this\s+)?ad/i;
    for (const element of document.querySelectorAll(controlSelector)) {
      if (!connected(element)) continue;
      const values = labels(element);
      if (values.some(value => skipPattern.test(value)) && visible(element)) {
        adMarker = true;
        break;
      }
      let speed = null;
      let quality = null;
      for (const value of values) {
        if (speed == null) speed = parseSpeed(value);
        if (quality == null) quality = parseQuality(value);
        if (speed != null && quality != null) break;
      }
      if (speed == null && quality == null) continue;
      const inMenu = roleContainer(element);
      if (inMenu) {
        if (!speed175Option && speed != null &&
            Math.abs(speed - 1.75) < 0.001) speed175Option = element;
        if (!lowOption && quality === '低') lowOption = element;
      } else {
        if (!speedIndicator && speed != null) {
          speedIndicator = element;
          speedIndicatorValue = speed;
        }
        if (!qualityIndicator && quality) {
          qualityIndicator = element;
          qualityIndicatorValue = quality;
        }
      }
    }
    if (!adMarker) {
      for (const element of document.querySelectorAll(
          '[data-testid*="advert" i],[data-testid*="commercial" i],'
          + '[class*="advert" i],[class*="commercial" i]')) {
        if (visible(element)) {
          adMarker = true;
          break;
        }
      }
    }
  }
  const programMedia = duration > 65 && !adMarker;

  if (programMedia) {
    // Reinforce the media element immediately, but also synchronize TVer's own
    // player state below so it cannot later restore 1.0x from its UI model.
    // Avoid even resolving native setters on a healthy tick: repeated writes
    // can dispatch ratechange events and wake the watchdog again.
    if (video.defaultPlaybackRate !== 1.75 || video.playbackRate !== 1.75) {
      try {
        const mediaPrototype = typeof HTMLMediaElement !== 'undefined'
            ? HTMLMediaElement.prototype : null;
        const rateSetter = mediaPrototype
            ? Object.getOwnPropertyDescriptor(mediaPrototype, 'playbackRate')?.set
            : null;
        const defaultRateSetter = mediaPrototype
            ? Object.getOwnPropertyDescriptor(mediaPrototype, 'defaultPlaybackRate')?.set
            : null;
        if (video.defaultPlaybackRate !== 1.75) {
          if (defaultRateSetter) defaultRateSetter.call(video, 1.75);
          else video.defaultPlaybackRate = 1.75;
        }
        if (video.playbackRate !== 1.75) {
          if (rateSetter) rateSetter.call(video, 1.75);
          else video.playbackRate = 1.75;
        }
      } catch (_) {
        try {
          if (video.defaultPlaybackRate !== 1.75) video.defaultPlaybackRate = 1.75;
          if (video.playbackRate !== 1.75) video.playbackRate = 1.75;
        } catch (_) {}
      }
    }

    const speedConfirmed = Boolean(
        (speedIndicator && Math.abs(speedIndicatorValue - 1.75) < 0.001) ||
        (speed175Option && selected(speed175Option)));
    state.currentSettingsSpeedConfirmed = speedConfirmed;
    if (!speedConfirmed) {
      state.fullscreenCornerTapAt = now;
      if (speed175Option && clickOnce(speed175Option, 'speed-175', 700)) return;
      if (speedIndicator && clickOnce(speedIndicator, 'speed-menu', 900)) return;
      schedule(700);
    }
)JS" LR"JS(

    const qualityConfirmed = Boolean(
        (qualityIndicator && qualityIndicatorValue === '低') ||
        (lowOption && selected(lowOption)));
    state.currentSettingsQualityConfirmed = qualityConfirmed;
    if (qualityConfirmed) state.qualityApplied = true;
    if (!qualityConfirmed) {
      state.fullscreenCornerTapAt = now;
      if (lowOption && clickOnce(lowOption, 'quality-low-v2', 700)) return;
      if (qualityIndicator &&
          clickOnce(qualityIndicator, 'quality-menu-v2', 900)) return;
      schedule(700);
    }

    // Keep setting menus reachable until TVer's own UI confirms both values.
    if (!speedConfirmed || !qualityConfirmed) {
      state.fullscreenCornerTapAt = now;
      schedule(700);
      return;
    }
  } else {
    // Ads do not permit speed changes. Retry after the long-form program media
    // replaces the ad video.
    state.currentSettingsSpeedConfirmed = false;
    state.currentSettingsQualityConfirmed = false;
    state.fullscreenCornerTapAt = now;
    schedule(900);
  }

  const fullscreen = Boolean(
      document.fullscreenElement || document.webkitFullscreenElement ||
      document.msFullscreenElement);
  if (fullscreen) {
    state.currentSettingsFullscreenRequestAt = 0;
    state.fullscreenCornerTapAt = 0;
    return;
  }

  // Fullscreen requires a trusted user gesture. Ask the native WebView2 bridge
  // to use Runtime.evaluate(userGesture=true), with its trusted F-key fallback,
  // instead of guessing that the bottom-right pixel is still the fullscreen
  // button after TVer's redesign.
  state.fullscreenCornerTapAt = now;
  if (!state.currentSettingsFullscreenRequestAt ||
      now - state.currentSettingsFullscreenRequestAt >= 3000) {
    state.currentSettingsFullscreenRequestAt = now;
    post('homepanel:tver-fullscreen-key');
  }
  schedule(900);
})()
)JS"