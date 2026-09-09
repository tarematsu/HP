// YouTube watchdog policy.
//
// One adaptive watchdog owns health, quality and trusted control recovery.
// Stable trusted input, cooldowns, coordinate pinning and Fullscreen API
// activation live in media_youtube_trusted_action.inc.
namespace {
constexpr wchar_t kNativeMediaYoutubeControlRecoveryScript[] = LR"JS(
(() => {
  const player = document.querySelector('#movie_player');
  const trusted = window.__homePanelYoutubeTrustedAction;
  if (!player || !trusted) return null;

  const video = player.querySelector('video');
  const visibleError = Array.from(document.querySelectorAll(
      '.ytp-error, .ytp-error-content-wrap, .ytp-error-content, '
      + 'yt-player-error-message-renderer, ytd-player-error-message-renderer'))
      .some(element => trusted.valid(element));
  if ((video && video.error) || player.classList.contains('ytp-error') || visibleError) {
    return 'reload';
  }

  // Surveys cover the ad controls, so resolve them before ad-skip discovery.
  const submitPattern = /^(送信|回答を送信|submit|send)$/i;
  const surveyRoots = Array.from(document.querySelectorAll(
      '.ytp-ad-survey, .ytp-ad-feedback-dialog, yt-survey-renderer, '
      + 'ytd-survey-renderer, tp-yt-paper-dialog, [role="dialog"]'));
  for (const root of surveyRoots) {
    if (!trusted.valid(root)) continue;
    const controls = Array.from(root.querySelectorAll(
        'button, tp-yt-paper-button, [role="button"], [role="radio"]'))
        .filter(element => trusted.valid(element));
    const submit = controls.find(element => submitPattern.test(trusted.text(element)));
    if (!submit) continue;
    const options = controls.filter(element => {
      if (element === submit) return false;
      const value = trusted.text(element);
      return value && !submitPattern.test(value) &&
          !/^(閉じる|キャンセル|cancel|close|skip|スキップ)$/i.test(value);
    });
    if (!options.length) continue;
    const survey = window.__homePanelYoutubeSurveyState ||
        (window.__homePanelYoutubeSurveyState = { step: 0, at: 0 });
    if (Date.now() - Number(survey.at || 0) > 8000) survey.step = 0;
    survey.at = Date.now();
    if (survey.step === 0) {
      survey.step = 1;
      return trusted.arm(options[0], 'survey-option', 500);
    }
    survey.step = 0;
    return trusted.arm(submit, 'survey-submit', 500);
  }

  const adShowing = trusted.ad();
  const skipSelectors = [
    '.ytp-ad-skip-button', '.ytp-ad-skip-button-modern',
    '.ytp-skip-ad-button', '.videoAdUiSkipButton',
    '.ytp-ad-skip-button-slot button',
    '.ytp-ad-skip-button-slot [role="button"]',
    '.ytp-ad-skip-button-container button',
    '.ytp-ad-skip-button-container [role="button"]',
    'button[class*="ytp-ad-skip"]',
    '[class*="ytp-ad-skip"][role="button"]',
    'button[aria-label*="Skip ad" i]', 'button[aria-label*="Skip ads" i]',
    'button[aria-label*="広告をスキップ"]', 'button[aria-label*="広告を飛ばす"]',
    '[role="button"][aria-label*="Skip ad" i]',
    '[role="button"][aria-label*="広告をスキップ"]'
  ];
  let target = Array.from(player.querySelectorAll(skipSelectors.join(',')))
      .find(element => trusted.valid(element)) || null;
  if (!target && adShowing) {
    const skipPattern = /(広告をスキップ|広告を飛ばす|(?:^|\s)スキップ(?:\s|$)|skip\s*ad(?:s)?)/i;
    target = Array.from(player.querySelectorAll(
        'button, tp-yt-paper-button, [role="button"]'))
        .find(element => trusted.valid(element) &&
            skipPattern.test(trusted.text(element))) || null;
  }
  if (adShowing && target) return trusted.arm(target, 'skip-ad', 600);

  // An unskippable ad must never fall through to content recovery or quality
  // changes. Re-check soon through the adaptive native cadence instead.
  if (adShowing) return 'recovery';

  try {
    const preferredQuality = 'large';
    if (typeof player.setPlaybackQualityRange === 'function') {
      player.setPlaybackQualityRange(preferredQuality, preferredQuality);
    }
    if (typeof player.setPlaybackQuality === 'function') {
      player.setPlaybackQuality(preferredQuality);
    }
  } catch (_) {
  }

  const captions = player.querySelector('.ytp-subtitles-button');
  if (captions && captions.getAttribute('aria-pressed') === 'true') {
    try { captions.click(); } catch (_) {}
  } else {
    try {
      if (typeof player.setOption === 'function') player.setOption('captions', 'track', {});
    } catch (_) {}
  }

  if (video && video.paused && !video.ended) {
    try {
      const pending = video.play();
      if (pending && typeof pending.catch === 'function') pending.catch(() => {});
    } catch (_) {}
    const play = player.querySelector('.ytp-play-button');
    if (trusted.valid(play)) return trusted.arm(play, 'play', 1500);
    return 'recovery';
  }

  if (trusted.fullscreen()) return null;
  target = player.querySelector('.ytp-fullscreen-button');
  if (!trusted.valid(target)) {
    const fullscreenPattern = /(全画面|fullscreen|full screen)/i;
    target = Array.from(player.querySelectorAll(
        'button, [role="button"], [aria-label], [title]'))
        .find(element => trusted.valid(element) &&
            fullscreenPattern.test(trusted.text(element))) || null;
  }
  return trusted.arm(target, 'fullscreen', 1200);
})()
)JS";
}  // namespace
