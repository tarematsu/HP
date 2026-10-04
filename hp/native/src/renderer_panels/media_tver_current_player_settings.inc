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
  const labels = element => [
    element?.getAttribute?.('aria-label'),
    element?.getAttribute?.('title'),
    element?.innerText,
    element?.textContent,
    element?.getAttribute?.('data-testid')
  ].map(clean).filter(Boolean);
  const selected = element => Boolean(element && (
      element.getAttribute?.('aria-checked') === 'true' ||
      element.getAttribute?.('aria-selected') === 'true' ||
      element.getAttribute?.('data-state') === 'checked' ||
      labels(element).some(value => /選択中|設定中|selected/i.test(value))));
  const visible = element => {
    if (!connected(element)) return false;
    const rect = element.getBoundingClientRect?.();
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
    'button', '[role="button"]', '[role="menuitem"]', '[role="option"]',
    '[role="radio"]', '[aria-label]', '[title]', '[data-testid]'
  ].join(',');
  const controls = Array.from(document.querySelectorAll(controlSelector))
      .filter(connected);
  const roleContainer = element => {
    const role = element?.getAttribute?.('role') || '';
    if (/^(?:menuitem|option|radio)$/i.test(role)) return true;
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

  const questionnaire = Array.from(document.querySelectorAll('[role="dialog"]'))
      .some(dialog => dialog.querySelector?.('form[id^="questionnaire-"]') ||
          /アンケート/.test(clean(dialog.textContent)));
  const posterPlay = document.getElementById?.('episode-play');
  if (questionnaire || visible(posterPlay)) {
    // Do not hide a required questionnaire or race the initial Play action.
    state.fullscreenCornerTapAt = now;
    schedule(900);
    return;
  }

  const videos = Array.from(document.querySelectorAll('video'));
  const videoScore = video => {
    if (!video?.isConnected) return -1;
    const rect = video.getBoundingClientRect?.();
    const area = Math.max(0, Number(rect?.width) || 0) *
        Math.max(0, Number(rect?.height) || 0);
    let score = area;
    if (visible(video)) score += 1000000000;
    if ((video.currentSrc || video.src || '').trim()) score += 500000000;
    if (!video.paused && !video.ended) score += 2000000000;
    if (Number(video.readyState || 0) >= 2) score += 250000000;
    return score;
  };
  const video = videos.reduce((best, candidate) =>
    videoScore(candidate) > videoScore(best) ? candidate : best, null);
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
  const adMarker = controls.some(element => labels(element).some(value =>
      /(?:広告|CM).{0,14}スキップ|skip\s+(?:this\s+)?ad/i.test(value))) ||
      Boolean(document.querySelector(
          '[data-testid*="advert" i],[data-testid*="commercial" i],'
          + '[class*="advert" i],[class*="commercial" i]'));
  const programMedia = duration > 65 && !adMarker;

  const parseSpeed = value => {
    const compact = clean(value)
        .replace(/\s+/g, '')
        .replace(/(?:倍速|倍)$/g, '')
        .replace(/^(?:再生)?速度[:：]?/i, '');
    const match = compact.match(/^(?:×|x)?(1(?:\.0+|\.25|\.5(?:0)?|\.75))(?:選択中|設定中)?$/i);
    return match ? Number(match[1]) : null;
  };
  const speedValue = element => {
    for (const value of labels(element)) {
      const parsed = parseSpeed(value);
      if (parsed != null) return parsed;
    }
    return null;
  };
  const parseQuality = value => {
    const compact = clean(value)
        .replace(/\s+/g, '')
        .replace(/^画質[:：]?/i, '')
        .replace(/画質$/i, '')
        .replace(/(?:選択中|設定中)$/g, '');
    return /^(?:自動|高|中|低)$/i.test(compact) ? compact : null;
  };
  const qualityValue = element => {
    for (const value of labels(element)) {
      const parsed = parseQuality(value);
      if (parsed) return parsed;
    }
    return null;
  };

  if (programMedia) {
    // Reinforce the media element immediately, but also synchronize TVer's own
    // player state below so it cannot later restore 1.0x from its UI model.
    try {
      const mediaPrototype = typeof HTMLMediaElement !== 'undefined'
          ? HTMLMediaElement.prototype : null;
      const rateSetter = mediaPrototype
          ? Object.getOwnPropertyDescriptor(mediaPrototype, 'playbackRate')?.set
          : null;
      const defaultRateSetter = mediaPrototype
          ? Object.getOwnPropertyDescriptor(mediaPrototype, 'defaultPlaybackRate')?.set
          : null;
      if (defaultRateSetter) defaultRateSetter.call(video, 1.75);
      else video.defaultPlaybackRate = 1.75;
      if (rateSetter) rateSetter.call(video, 1.75);
      else video.playbackRate = 1.75;
    } catch (_) {
      try {
        video.defaultPlaybackRate = 1.75;
        video.playbackRate = 1.75;
      } catch (_) {}
    }

    const speedElements = controls.filter(element => speedValue(element) != null);
    const speed175Option = speedElements.find(element =>
      Math.abs(speedValue(element) - 1.75) < 0.001 && roleContainer(element));
    const speedIndicator = speedElements.find(element => !roleContainer(element));
    const speedConfirmed = Boolean(
        (speedIndicator && Math.abs(speedValue(speedIndicator) - 1.75) < 0.001) ||
        (speed175Option && selected(speed175Option)));
    state.currentSettingsSpeedConfirmed = speedConfirmed;
    if (!speedConfirmed) {
      state.fullscreenCornerTapAt = now;
      if (speed175Option && clickOnce(speed175Option, 'speed-175', 700)) return;
      if (speedIndicator && clickOnce(speedIndicator, 'speed-menu', 900)) return;
      schedule(700);
    }

    const qualityElements = controls.filter(element => qualityValue(element));
    const lowOption = qualityElements.find(element =>
      qualityValue(element) === '低' && roleContainer(element));
    const qualityIndicator = qualityElements.find(element => !roleContainer(element));
    const qualityConfirmed = Boolean(
        (qualityIndicator && qualityValue(qualityIndicator) === '低') ||
        (lowOption && selected(lowOption)));
    state.currentSettingsQualityConfirmed = qualityConfirmed;
    // Share confirmation with the legacy recovery body so it does not reopen an
    // obsolete settings menu after the current TVer UI already reports "低".
    if (qualityConfirmed) state.qualityApplied = true;
    if (!qualityConfirmed) {
      state.fullscreenCornerTapAt = now;
      if (lowOption && clickOnce(lowOption, 'quality-low-v2', 700)) return;
      if (qualityIndicator &&
          clickOnce(qualityIndicator, 'quality-menu-v2', 900)) return;
      schedule(700);
    }
  } else {
    // TVer does not permit speed changes during ads. Keep retrying when the
    // long-form program media replaces the ad video.
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