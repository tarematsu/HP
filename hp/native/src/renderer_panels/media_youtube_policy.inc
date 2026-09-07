// YouTube playback policy kept outside the large media host implementation so
// startup playback, survey handling, ad skipping and quality selection stay
// independently testable.
namespace {
constexpr wchar_t kNativeMediaYoutubePlayAllPolicyScript[] = LR"JS(
(() => {
  if (window.innerWidth <= 0 || window.innerHeight <= 0) return null;
  const normalize = value => (value || '').replace(/\s+/g, ' ').trim();
  const isClickable = element => {
    if (!element || element.disabled ||
        element.getAttribute('aria-disabled') === 'true' ||
        element.getAttribute('aria-hidden') === 'true') return false;
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' &&
           style.opacity !== '0' && style.pointerEvents !== 'none' &&
           rect.width > 0 && rect.height > 0;
  };
  const point = element => {
    if (!isClickable(element)) return null;
    const rect = element.getBoundingClientRect();
    return [
      Math.max(0, Math.min(10000, Math.round(
          ((rect.left + rect.width / 2) / window.innerWidth) * 10000))),
      Math.max(0, Math.min(10000, Math.round(
          ((rect.top + rect.height / 2) / window.innerHeight) * 10000)))
    ];
  };
  const textOf = element => normalize([
    element?.getAttribute?.('aria-label'),
    element?.getAttribute?.('title'),
    element?.textContent
  ].filter(Boolean).join(' '));

  // Prefer the playlist's explicit Play all control. YouTube changes the exact
  // element type and Japanese label periodically, so detect semantics rather
  // than one hard-coded selector/label pair.
  const candidates = Array.from(document.querySelectorAll(
      'button, a, tp-yt-paper-button, [role="button"]'));
  let target = candidates.find(element => {
    if (!isClickable(element)) return false;
    const text = textOf(element);
    return /^(すべて再生(?:する)?|全て再生(?:する)?)(?:\s|$)/.test(text) ||
           /^play all(?:\s|$)/i.test(text);
  }) || null;

  // If the Play all control is absent in a YouTube layout experiment, opening
  // the first playlist video is equivalent for this dedicated playlist view.
  if (!target) {
    target = Array.from(document.querySelectorAll(
        'ytd-playlist-video-renderer a#thumbnail, '
        + 'ytd-playlist-video-renderer a#video-title'))
        .find(isClickable) || null;
  }
  return point(target);
})()
)JS";

constexpr wchar_t kNativeMediaYoutubeWatchdogPolicyScript[] = LR"JS(
(() => {
  const player = document.querySelector('#movie_player');
  if (!player || window.innerWidth <= 0 || window.innerHeight <= 0) return null;

  const normalize = value => (value || '').replace(/\s+/g, ' ').trim();
  const isClickable = element => {
    if (!element || element.disabled ||
        element.getAttribute('aria-disabled') === 'true' ||
        element.getAttribute('aria-hidden') === 'true') return false;
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' &&
           style.opacity !== '0' && style.pointerEvents !== 'none' &&
           rect.width > 0 && rect.height > 0;
  };
  const isVisible = element => {
    if (!element) return false;
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' &&
           style.opacity !== '0' && rect.width > 0 && rect.height > 0;
  };
  const point = element => {
    if (!isClickable(element)) return null;
    const rect = element.getBoundingClientRect();
    return [
      Math.max(0, Math.min(10000, Math.round(
          ((rect.left + rect.width / 2) / window.innerWidth) * 10000))),
      Math.max(0, Math.min(10000, Math.round(
          ((rect.top + rect.height / 2) / window.innerHeight) * 10000)))
    ];
  };
  const guardedPoint = (element, action, cooldownMs) => {
    const resolved = point(element);
    if (!resolved) return null;
    const now = Date.now();
    const state = window.__homePanelYoutubeTrustedActionState ||
        (window.__homePanelYoutubeTrustedActionState = { action: '', at: 0 });
    if (state.action === action && now - Number(state.at || 0) < cooldownMs) {
      return null;
    }
    state.action = action;
    state.at = now;
    return resolved;
  };
  const textOf = element => normalize([
    element?.getAttribute?.('aria-label'),
    element?.getAttribute?.('title'),
    element?.textContent
  ].filter(Boolean).join(' '));

  // YouTube occasionally shows a five-choice survey over the player. Drive it
  // as two trusted clicks across watchdog passes: first option, then Submit.
  const submitPattern = /^(送信|回答を送信|submit|send)$/i;
  const surveyRoots = Array.from(document.querySelectorAll(
      '.ytp-ad-survey, .ytp-ad-feedback-dialog, yt-survey-renderer, '
      + 'ytd-survey-renderer, tp-yt-paper-dialog, [role="dialog"]'))
      .filter(isClickable);
  for (const root of surveyRoots) {
    const submit = Array.from(root.querySelectorAll(
        'button, tp-yt-paper-button, [role="button"]'))
        .find(element => isClickable(element) &&
            submitPattern.test(textOf(element).toLowerCase()));
    if (!submit) continue;

    let options = Array.from(root.querySelectorAll(
        '.ytp-ad-survey-answer-button, [role="radio"], '
        + 'tp-yt-paper-radio-button, input[type="radio"]'))
        .filter(isClickable);
    if (options.length < 5) {
      options = Array.from(root.querySelectorAll(
          'button, tp-yt-paper-button, [role="button"]'))
          .filter(element => {
            if (!isClickable(element) || element === submit) return false;
            const text = textOf(element).toLowerCase();
            return text && !submitPattern.test(text) &&
                   !/^(閉じる|キャンセル|cancel|close|skip|スキップ)$/i.test(text);
          });
    }
    if (options.length < 5) continue;

    const surveyKey = normalize(root.textContent).slice(0, 180);
    const now = Date.now();
    const state = window.__homePanelYoutubeSurveyState ||
        (window.__homePanelYoutubeSurveyState = { key: '', step: 0, at: 0 });
    if (state.key !== surveyKey || now - state.at > 8000) {
      state.key = surveyKey;
      state.step = 0;
    }
    state.at = now;
    if (state.step === 0) {
      state.step = 1;
      return point(options[0]);
    }
    state.step = 0;
    return point(submit);
  }

  const captionsButton = player.querySelector('.ytp-subtitles-button');
  if (captionsButton && captionsButton.getAttribute('aria-pressed') === 'true') {
    try { captionsButton.click(); } catch (_) {}
  } else {
    try {
      if (typeof player.setOption === 'function') {
        player.setOption('captions', 'track', {});
      }
    } catch (_) {}
  }

  // Prefer current known classes and aria-labels, then fall back to semantics.
  // The click itself is performed by the native trusted-input path so YouTube's
  // event.isTrusted checks cannot turn this into a no-op DOM click.
  const selectors = [
    '.ytp-ad-skip-button',
    '.ytp-ad-skip-button-modern',
    '.ytp-skip-ad-button',
    '.videoAdUiSkipButton',
    '.ytp-ad-skip-button-slot button',
    '.ytp-ad-skip-button-container button',
    'button[class*="ytp-ad-skip"]',
    'button[aria-label*="Skip ad" i]',
    'button[aria-label*="Skip ads" i]',
    'button[aria-label*="広告をスキップ"]',
    'button[aria-label*="スキップ"]'
  ];
  let target = Array.from(player.querySelectorAll(selectors.join(',')))
      .find(isClickable) || null;
  if (!target) {
    const skipPattern = /(広告をスキップ|広告を飛ばす|skip\s+ad(?:s)?)/i;
    target = Array.from(player.querySelectorAll(
        'button, tp-yt-paper-button, [role="button"]'))
        .find(element => isClickable(element) && skipPattern.test(textOf(element))) ||
        null;
  }
  if (target) return guardedPoint(target, 'skip-ad', 750);

  const adOverlay = player.querySelector(
      '.ytp-ad-player-overlay, .ytp-ad-player-overlay-layout');
  const adShowing = player.classList.contains('ad-showing') || isVisible(adOverlay);
  if (adShowing) return null;

  // Recover startup/autoplay failures. The playlist click may have navigated to
  // the watch page while playback remained paused; only click when the media
  // element itself reports paused so this can never toggle a playing video off.
  const video = player.querySelector('video');
  if (video && video.paused && !video.ended) {
    target = player.querySelector('.ytp-play-button');
    if (isClickable(target)) return guardedPoint(target, 'play', 2000);
  }

  const fullscreen = document.fullscreenElement ||
      player.classList.contains('ytp-fullscreen');
  if (fullscreen) return null;
  target = player.querySelector('.ytp-fullscreen-button');
  return guardedPoint(target, 'fullscreen', 2500);
})()
)JS";

constexpr wchar_t kNativeMediaYoutubeHealthPolicyScript[] = LR"JS(
(() => {
  // The reliable playlist probe is supposed to stay active until /watch. The
  // legacy host still has a ten-second fixed-coordinate fallback; if that path
  // leaves us on /playlist, report it as unhealthy so the host reloads and
  // restarts the reliable probe instead of remaining stuck indefinitely.
  if ((location.hostname === 'www.youtube.com' ||
       location.hostname === 'youtube.com') &&
      location.pathname.startsWith('/playlist')) {
    const startupState = window.__homePanelYoutubePlaylistStartupState;
    const since = Number(startupState?.since || 0);
    if (since > 0 && Date.now() - since >= 8000) return true;
  }

  const player = document.querySelector('#movie_player');
  if (player) {
    try {
      if (typeof player.setPlaybackQualityRange === 'function') {
        player.setPlaybackQualityRange('hd720', 'hd720');
      }
      if (typeof player.setPlaybackQuality === 'function') {
        player.setPlaybackQuality('hd720');
      }
      if (typeof player.getAvailableQualityLevels === 'function') {
        const levels = player.getAvailableQualityLevels() || [];
        if (levels.includes('hd720') &&
            typeof player.getPlaybackQuality === 'function' &&
            player.getPlaybackQuality() !== 'hd720' &&
            typeof player.setPlaybackQuality === 'function') {
          player.setPlaybackQuality('hd720');
        }
      }
    } catch (_) {}
  }
  const video = document.querySelector('video');
  if (video && video.error) return true;
  if (player && player.classList.contains('ytp-error')) return true;
  const error = document.querySelector(
      '.ytp-error, .ytp-error-content-wrap, .ytp-error-content, '
      + 'yt-player-error-message-renderer, ytd-player-error-message-renderer');
  if (!error) return false;
  const style = window.getComputedStyle(error);
  const rect = error.getBoundingClientRect();
  return style.display !== 'none' && style.visibility !== 'hidden' &&
         rect.width > 0 && rect.height > 0;
})()
)JS";
}  // namespace
