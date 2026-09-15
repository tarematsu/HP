// Single YouTube recovery policy. Ad handling, playback recovery and one-shot
// player preferences intentionally share one state machine.
namespace {
constexpr wchar_t kNativeMediaYoutubeControlRecoveryScript[] = LR"JS(
(() => {
  const recheck = () => {
    const agent = window.__homePanelYoutubeEventAgent;
    if (typeof agent?.scheduleRecoveryWake === 'function') {
      agent.scheduleRecoveryWake(2000);
      return;
    }
    if (window.__homePanelYoutubeStartupRecoveryTimer) return;
    window.__homePanelYoutubeStartupRecoveryTimer = setTimeout(() => {
      window.__homePanelYoutubeStartupRecoveryTimer = 0;
      try { window.chrome?.webview?.postMessage('homepanel:youtube-wake'); }
      catch (_) {}
    }, 2000);
  };

  const player = document.querySelector('#movie_player');
  const trusted = window.__homePanelYoutubeTrustedAction;
  if (!player || !trusted) {
    recheck();
    return 'recovery';
  }
  const video = player.querySelector('video');
  if (video?.error || player.classList.contains('ytp-error')) return 'reload';

  const now = Date.now();
  const fullscreenSettleMs = 1500;
  const armFullscreen = () => {
    let target = player.querySelector('.ytp-fullscreen-button');
    if (!trusted.valid(target)) {
      target = Array.from(player.querySelectorAll(
          'button,[role="button"],[aria-label],[title]'))
          .find(element => trusted.valid(element) &&
              /(全画面|fullscreen|full screen)/i.test(trusted.text(element))) || null;
    }
    return trusted.arm(target, 'fullscreen', 1200);
  };

  if (trusted.ad()) {
    const adState = window.__homePanelYoutubeAdState ||
        (window.__homePanelYoutubeAdState = { active: false, fullscreenReadyAt: 0 });
    if (!adState.active) {
      adState.active = true;
      adState.fullscreenReadyAt = now + fullscreenSettleMs;
    }

    const submitPattern = /^(送信|回答を送信|submit|send)$/i;
    const roots = player.querySelectorAll(
        '.ytp-ad-survey,.ytp-ad-feedback-dialog,yt-survey-renderer,'
        + 'ytd-survey-renderer,[role="dialog"]');
    for (const root of roots) {
      if (!trusted.valid(root)) continue;
      const controls = Array.from(root.querySelectorAll(
          'button,tp-yt-paper-button,[role="button"],[role="radio"]'))
          .filter(trusted.valid);
      const submit = controls.find(element =>
          submitPattern.test(trusted.text(element)));
      const option = controls.find(element => element !== submit &&
          !/^(閉じる|キャンセル|cancel|close|skip|スキップ)$/i
              .test(trusted.text(element)));
      if (submit && option) {
        const survey = window.__homePanelYoutubeSurveyState ||
            (window.__homePanelYoutubeSurveyState = { selected: false });
        if (!survey.selected) {
          survey.selected = true;
          return trusted.arm(option, 'survey-option', 500);
        }
        survey.selected = false;
        return trusted.arm(submit, 'survey-submit', 500);
      }
    }

    if (!trusted.fullscreen() && now >= adState.fullscreenReadyAt) {
      const action = armFullscreen();
      if (action) return action;
    }

    const skipSelectors = [
      '.ytp-ad-skip-button', '.ytp-ad-skip-button-modern',
      '.ytp-skip-ad-button', '.videoAdUiSkipButton',
      '[class*="ytp-ad-skip"]', '[aria-label*="Skip ad" i]',
      '[aria-label*="広告をスキップ"]', '[aria-label*="広告を飛ばす"]'
    ];
    let target = Array.from(player.querySelectorAll(skipSelectors.join(',')))
        .find(trusted.valid) || null;
    if (!target) {
      target = Array.from(player.querySelectorAll(
          'button,tp-yt-paper-button,[role="button"]'))
          .find(element => trusted.valid(element) &&
              /(広告をスキップ|広告を飛ばす|skip\s*ad(?:s)?)/i
                  .test(trusted.text(element))) || null;
    }
    if (target) return trusted.arm(target, 'skip-ad', 600);
    recheck();
    return 'recovery';
  }

  const adState = window.__homePanelYoutubeAdState;
  if (adState) adState.active = false;

  const state = window.__homePanelYoutubeRecoveryState ||
      (window.__homePanelYoutubeRecoveryState = {
        videoKey: '', qualityApplied: false, captionsApplied: false,
        fullscreenApplied: false, fullscreenReadyAt: now + fullscreenSettleMs,
        pausedSince: 0, playRetryAttempted: false,
        lastCurrentTime: -1, lastProgressAt: now, nextRequestedAt: 0
      });
  const url = new URL(location.href);
  const videoKey = url.searchParams.get('v') || video?.currentSrc || '';
  const playlistId = url.searchParams.get('list') || '';
  if (state.videoKey !== videoKey) {
    Object.assign(state, {
      videoKey, qualityApplied: false, captionsApplied: false,
      fullscreenApplied: false, fullscreenReadyAt: now + fullscreenSettleMs,
      pausedSince: 0, playRetryAttempted: false,
      lastCurrentTime: -1, lastProgressAt: now, nextRequestedAt: 0
    });
  }

  const currentTime = Number(video?.currentTime);
  if (Number.isFinite(currentTime)) {
    if (state.lastCurrentTime < 0 ||
        currentTime > state.lastCurrentTime + 0.25 ||
        currentTime + 2 < state.lastCurrentTime) {
      state.lastProgressAt = now;
      state.nextRequestedAt = 0;
    }
    state.lastCurrentTime = currentTime;
  }

  const advance = () => {
    if (now - Number(state.nextRequestedAt || 0) < 8000) {
      recheck();
      return 'recovery';
    }
    const next = player.querySelector('.ytp-next-button[href]');
    try {
      const candidate = new URL(next?.href || '', location.href);
      if (candidate.pathname === '/watch' &&
          candidate.searchParams.get('v') &&
          candidate.searchParams.get('list') === playlistId &&
          candidate.href !== location.href) {
        state.nextRequestedAt = now;
        location.assign(candidate.href);
        return 'recovery';
      }
    } catch (_) {}
    try {
      if (typeof player.nextVideo === 'function') {
        state.nextRequestedAt = now;
        player.nextVideo();
        recheck();
        return 'recovery';
      }
    } catch (_) {}
    const button = player.querySelector('.ytp-next-button');
    const action = trusted.arm(button, 'next', 3000);
    if (action) state.nextRequestedAt = now;
    return action || 'reload';
  };

  if (video?.ended) return advance();

  const pauseEscalationMs = 10 * 1000;
  const stallEscalationMs = 30 * 1000;
  if (video?.paused && !video.ended) {
    if (!state.pausedSince) state.pausedSince = now;
    if (!state.playRetryAttempted) {
      state.playRetryAttempted = true;
      try { video.play()?.catch?.(() => {}); } catch (_) {}
      const play = player.querySelector('.ytp-play-button');
      const action = trusted.arm(play, 'play', 1500);
      if (action) return action;
    }
    if (now - state.pausedSince >= pauseEscalationMs) return advance();
    recheck();
    return 'recovery';
  }

  if (video) {
    state.pausedSince = 0;
    state.playRetryAttempted = false;
    if (now - state.lastProgressAt >= stallEscalationMs) return advance();
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
    try {
      if (captions?.getAttribute('aria-pressed') === 'true') captions.click();
      else if (typeof player.setOption === 'function') {
        player.setOption('captions', 'track', {});
      }
      state.captionsApplied = true;
    } catch (_) {}
  }

  if (trusted.fullscreen()) {
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
