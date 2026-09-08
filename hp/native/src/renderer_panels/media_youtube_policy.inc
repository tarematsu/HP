// YouTube playback policy kept outside the large media host implementation so
// startup playback, survey handling, ad skipping and quality selection stay
// independently testable.
namespace {
constexpr wchar_t kNativeMediaYoutubeCleanPlayerScript[] = LR"JS(
(() => {
  if (location.hostname !== 'www.youtube.com' &&
      location.hostname !== 'youtube.com') return false;

  const mount = () => {
    const root = document.head || document.documentElement;
    if (!root || document.getElementById('homepanel-youtube-clean-player')) {
      return;
    }
    const style = document.createElement('style');
    style.id = 'homepanel-youtube-clean-player';
    style.textContent = `
      #movie_player > :not(.html5-video-container),
      #movie_player .html5-video-container > :not(video),
      #movie_player .ytp-chrome-top,
      #movie_player .ytp-chrome-bottom,
      #movie_player .ytp-gradient-top,
      #movie_player .ytp-gradient-bottom,
      #movie_player .ytp-title,
      #movie_player .ytp-fullscreen-quick-actions,
      #movie_player .ytp-overlay-top-left,
      #movie_player .ytp-overlay-bottom-right,
      #movie_player yt-player-overlay-video-details-renderer,
      #movie_player .ytp-pause-overlay,
      #movie_player .ytp-ce-element,
      #movie_player .ytp-cards-button,
      #movie_player .ytp-paid-content-overlay,
      #movie_player .ytp-watermark,
      #movie_player .annotation,
      #movie_player .ytp-fullscreen-grid,
      #movie_player .ytp-fullscreen-grid-stills-container,
      #movie_player .ytp-fullscreen-grid-expand-button,
      #movie_player .ytp-caption-window-container {
        opacity: 0 !important;
        transition: none !important;
        animation: none !important;
      }
    `;
    root.appendChild(style);
  };

  mount();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount, { once: true });
  }
  return true;
})()
)JS";

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
  const isClickable = (element, allowTransparent = false) => {
    if (!element || element.disabled ||
        element.getAttribute('aria-disabled') === 'true' ||
        element.getAttribute('aria-hidden') === 'true') return false;
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' &&
           (allowTransparent || style.opacity !== '0') &&
           style.pointerEvents !== 'none' &&
           rect.width > 0 && rect.height > 0;
  };
  const point = (element, allowTransparent = false) => {
    if (!isClickable(element, allowTransparent)) return null;
    const rect = element.getBoundingClientRect();
    return [
      Math.max(0, Math.min(10000, Math.round(
          ((rect.left + rect.width / 2) / window.innerWidth) * 10000))),
      Math.max(0, Math.min(10000, Math.round(
          ((rect.top + rect.height / 2) / window.innerHeight) * 10000)))
    ];
  };
  const guardedPoint = (
      element, action, cooldownMs, allowTransparent = false) => {
    const resolved = point(element, allowTransparent);
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

  // Prefer current known classes and aria-labels, then fall back to semantics.
  // The clean-player CSS deliberately keeps controls in layout but makes them
  // transparent. Skip Ad is a narrowly identified trusted action, so opacity
  // must not suppress its coordinate lookup.
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
      .find(element => isClickable(element, true)) || null;
  if (!target) {
    const skipPattern = /(広告をスキップ|広告を飛ばす|skip\s+ad(?:s)?)/i;
    target = Array.from(player.querySelectorAll(
        'button, tp-yt-paper-button, [role="button"]'))
        .find(element => isClickable(element, true) &&
            skipPattern.test(textOf(element))) || null;
  }
  if (target) return guardedPoint(target, 'skip-ad', 750, true);

  // Treat ads as an isolated playback state. Apart from survey/skip actions,
  // never mutate player state while YouTube owns ad playback: caption toggles,
  // play recovery and fullscreen clicks can otherwise race an ad transition.
  const adShowing = player.classList.contains('ad-showing') ||
      player.classList.contains('ad-interrupting');
  if (adShowing) return null;

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
  // Autohide and the clean-player policy both make chrome transparent. Its
  // bounds and pointer target remain valid, so allow only this action through
  // the opacity guard.
  return guardedPoint(target, 'fullscreen', 2500, true);
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
  const adShowing = player &&
      (player.classList.contains('ad-showing') ||
       player.classList.contains('ad-interrupting'));
  // 720p is a content-video preference, not an ad recovery action. Reapplying
  // playback quality APIs during an ad can force a stream transition/rebuffer,
  // which looks like repeated pause/resume on slower WebView2 devices.
  if (player && !adShowing) {
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
