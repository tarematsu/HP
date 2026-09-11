// YouTube watchdog policy.
//
// One low-frequency watchdog owns health and trusted recovery. A lightweight
// page agent wakes it on media/ad/UI state transitions; steady playback does not
// continuously reapply quality, captions or other player settings.
namespace {
constexpr wchar_t kNativeMediaYoutubeControlRecoveryScript[] = LR"JS(
(() => {
  const player = document.querySelector('#movie_player');
  const trusted = window.__homePanelYoutubeTrustedAction;
  if (!player || !trusted) return null;

  const video = player.querySelector('video');
  const visibleError = Array.from(player.querySelectorAll(
      '.ytp-error, .ytp-error-content-wrap, .ytp-error-content, '
      + 'yt-player-error-message-renderer, ytd-player-error-message-renderer'))
      .some(element => trusted.valid(element));
  if ((video && video.error) || player.classList.contains('ytp-error') || visibleError) {
    return 'reload';
  }

  const adShowing = trusted.ad();
  let target = null;

  // Surveys are part of YouTube's ad surface. Resolve them only while an ad is
  // active and only inside the player, avoiding a document-wide dialog scan on
  // every healthy content watchdog pass.
  if (adShowing) {
    const submitPattern = /^(送信|回答を送信|submit|send)$/i;
    const surveyRoots = Array.from(player.querySelectorAll(
        '.ytp-ad-survey, .ytp-ad-feedback-dialog, yt-survey-renderer, '
        + 'ytd-survey-renderer, [role="dialog"]'));
    for (const root of surveyRoots) {
      if (!trusted.valid(root)) continue;
      const controls = Array.from(root.querySelectorAll(
          'button, tp-yt-paper-button, [role="button"], [role="radio"]'))
          .filter(element => trusted.valid(element));
      const submit = controls.find(element =>
          submitPattern.test(trusted.text(element)));
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

    // Fullscreen is allowed during ads and is restored before Skip so an
    // unskippable ad remains in the dedicated playback surface as well.
    if (!trusted.fullscreen()) {
      target = player.querySelector('.ytp-fullscreen-button');
      if (!trusted.valid(target)) {
        const fullscreenPattern = /(全画面|fullscreen|full screen)/i;
        target = Array.from(player.querySelectorAll(
            'button, [role="button"], [aria-label], [title]'))
            .find(element => trusted.valid(element) &&
                fullscreenPattern.test(trusted.text(element))) || null;
      }
      const fullscreenAction = trusted.arm(target, 'fullscreen', 1200);
      if (fullscreenAction) return fullscreenAction;
    }

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
    target = Array.from(player.querySelectorAll(skipSelectors.join(',')))
        .find(element => trusted.valid(element)) || null;
    if (!target) {
      const skipPattern = /(広告をスキップ|広告を飛ばす|(?:^|\s)スキップ(?:\s|$)|skip\s*ad(?:s)?)/i;
      target = Array.from(player.querySelectorAll(
          'button, tp-yt-paper-button, [role="button"]'))
          .find(element => trusted.valid(element) &&
              skipPattern.test(trusted.text(element))) || null;
    }
    if (target) return trusted.arm(target, 'skip-ad', 600);

    // Never let an unskippable ad fall through to content playback, quality or
    // caption mutation.
    return 'recovery';
  }

  const recoveryState = window.__homePanelYoutubeRecoveryState ||
      (window.__homePanelYoutubeRecoveryState = {
        videoKey: '', qualityApplied: false, captionsApplied: false
      });
  let videoKey = '';
  try {
    videoKey = new URL(location.href).searchParams.get('v') || '';
  } catch (_) {}
  if (!videoKey && video) videoKey = video.currentSrc || video.src || '';
  if (recoveryState.videoKey !== videoKey) {
    recoveryState.videoKey = videoKey;
    recoveryState.qualityApplied = false;
    recoveryState.captionsApplied = false;
  }

  // 480p is a per-content preference. Set it once for a new video, then only
  // repair it if YouTube later reports that the preference actually drifted.
  const preferredQuality = 'large';
  if (!recoveryState.qualityApplied) {
    let touched = false;
    try {
      if (typeof player.setPlaybackQualityRange === 'function') {
        player.setPlaybackQualityRange(preferredQuality, preferredQuality);
        touched = true;
      }
      if (typeof player.setPlaybackQuality === 'function') {
        player.setPlaybackQuality(preferredQuality);
        touched = true;
      }
    } catch (_) {}
    recoveryState.qualityApplied = touched;
  } else {
    try {
      if (typeof player.getPlaybackQuality === 'function' &&
          player.getPlaybackQuality() !== preferredQuality) {
        if (typeof player.setPlaybackQualityRange === 'function') {
          player.setPlaybackQualityRange(preferredQuality, preferredQuality);
        }
        if (typeof player.setPlaybackQuality === 'function') {
          player.setPlaybackQuality(preferredQuality);
        }
      }
    } catch (_) {}
  }

  const captions = player.querySelector('.ytp-subtitles-button');
  if (captions && captions.getAttribute('aria-pressed') === 'true') {
    try {
      captions.click();
      recoveryState.captionsApplied = true;
    } catch (_) {}
  } else if (!recoveryState.captionsApplied) {
    try {
      if (typeof player.setOption === 'function') {
        player.setOption('captions', 'track', {});
        recoveryState.captionsApplied = true;
      }
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
