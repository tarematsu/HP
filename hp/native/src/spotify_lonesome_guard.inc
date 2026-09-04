namespace hp {
namespace {

constexpr wchar_t kSpotifyLonesomeRabbitGuardScript[] = LR"JS(
(() => {
  const targetPath = '/album/2f2Ik9JeinFVWZuFb3i35b';
  const targetTitle = 'lonesome rabbit';
  const report = playing => {
    if (window.chrome && window.chrome.webview) {
      window.chrome.webview.postMessage(
          playing ? 'spotify:playing' : 'spotify:not-playing');
    }
  };
  const normalize = value => (value || '').replace(/\s+/g, ' ').trim();
  const visible = element => {
    if (!element || element.disabled ||
        element.getAttribute('aria-disabled') === 'true') return false;
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' &&
           style.pointerEvents !== 'none' && rect.width > 0 && rect.height > 0;
  };
  const labelOf = element => normalize(
      (element && (element.getAttribute('aria-label') ||
                   element.getAttribute('title'))) || '').toLowerCase();
  const buttonShowsPlaying = button => {
    const label = labelOf(button);
    return label.includes('pause') || label.includes('一時停止');
  };
  const playerControl = () => {
    const primary = document.querySelector(
        'button[data-testid="control-button-playpause"]');
    if (visible(primary)) return primary;
    return Array.from(document.querySelectorAll('button, [role="button"]'))
        .find(button => {
          if (!visible(button)) return false;
          const label = labelOf(button);
          return label === 'play' || label === 'pause' ||
                 label === '再生' || label === '一時停止';
        }) || null;
  };
  const currentTrackTitle = () => {
    const selectors = [
      '[data-testid="now-playing-widget"] [data-testid="context-item-link"]',
      '[data-testid="now-playing-widget"] a[href*="/track/"]',
      '[data-testid="context-item-link"][href*="/track/"]'
    ];
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      const title = normalize(element && element.textContent).toLowerCase();
      if (title) return title;
    }
    return '';
  };
  const targetPlayButton = () => {
    const links = Array.from(document.querySelectorAll('a[href*="/track/"]'));
    const targetLink = links.find(link =>
        normalize(link.textContent).toLowerCase() === targetTitle) || null;
    if (targetLink) {
      const row = targetLink.closest(
          '[data-testid="tracklist-row"], [role="row"], li, [aria-rowindex]') ||
          targetLink.parentElement?.parentElement;
      if (row) {
        const rowButtons = Array.from(row.querySelectorAll(
            'button[data-testid="play-button"], button, [role="button"]'));
        const rowPlay = rowButtons.find(button => {
          if (!visible(button)) return false;
          const label = labelOf(button);
          return label === 'play' || label === '再生' ||
                 label.includes(targetTitle) || label.includes('lonesome rabbit');
        });
        if (rowPlay) return rowPlay;
      }
    }
    const primary = Array.from(document.querySelectorAll(
        'button[data-testid="play-button"]')).find(visible);
    if (primary) return primary;
    return Array.from(document.querySelectorAll('button, [role="button"]'))
        .find(button => {
          if (!visible(button)) return false;
          const label = labelOf(button);
          return label.includes('lonesome rabbit') &&
                 (label.includes('play') || label.includes('再生'));
        }) || null;
  };
  const point = element => {
    if (!visible(element) || window.innerWidth <= 0 || window.innerHeight <= 0) {
      return null;
    }
    const rect = element.getBoundingClientRect();
    return [
      Math.max(0, Math.min(10000, Math.round(
          ((rect.left + rect.width / 2) / window.innerWidth) * 10000))),
      Math.max(0, Math.min(10000, Math.round(
          ((rect.top + rect.height / 2) / window.innerHeight) * 10000)))
    ];
  };
  const repeatState = button => {
    if (!button) return 'unknown';
    const checked = button.getAttribute('aria-checked');
    if (checked === 'true') return 'context';
    if (checked === 'mixed') return 'one';
    if (checked === 'false') return 'off';
    const label = labelOf(button);
    if (label.includes('enable repeat one') ||
        label.includes('1曲リピートをオン') ||
        label.includes('1曲リピートを有効')) return 'context';
    if (label.includes('disable repeat') ||
        label.includes('リピートをオフ') ||
        label.includes('リピートを無効')) return 'one';
    if (label.includes('enable repeat') ||
        label.includes('リピートをオン') ||
        label.includes('リピートを有効')) return 'off';
    return 'unknown';
  };
  const ensureRepeatOne = () => {
    const repeat = document.querySelector(
        'button[data-testid="control-button-repeat"]');
    if (!visible(repeat)) return;
    const state = repeatState(repeat);
    if (state === 'one' || state === 'unknown') return;
    try { repeat.click(); } catch (_) { return; }
    if (state === 'off') {
      window.setTimeout(() => {
        const current = document.querySelector(
            'button[data-testid="control-button-repeat"]');
        if (visible(current) && repeatState(current) === 'context') {
          try { current.click(); } catch (_) {}
        }
      }, 250);
    }
  };

  if (location.hostname !== 'open.spotify.com' ||
      !location.pathname.endsWith(targetPath)) {
    report(false);
    return null;
  }

  const control = playerControl();
  const currentTitle = currentTrackTitle();
  const targetButton = targetPlayButton();

  // Never accept an unrelated recommendation/queue item as healthy playback.
  // Force the album's Lonesome rabbit row whenever Spotify has wandered away.
  if (buttonShowsPlaying(control) && currentTitle && currentTitle !== targetTitle) {
    report(false);
    return point(targetButton);
  }
  if (buttonShowsPlaying(control) && !currentTitle && visible(targetButton) &&
      !buttonShowsPlaying(targetButton)) {
    report(false);
    return point(targetButton);
  }

  if (buttonShowsPlaying(control) &&
      (currentTitle === targetTitle || buttonShowsPlaying(targetButton))) {
    ensureRepeatOne();
    report(true);
    return true;
  }

  report(false);
  return point(visible(control) && currentTitle === targetTitle
      ? control : targetButton);
})()
)JS";

const wchar_t* RewriteSpotifyPhaseExecuteScript(const wchar_t* script) noexcept {
  if (!script) return script;
  const std::wstring_view value(script);
  if (value.find(L"/album/2f2Ik9JeinFVWZuFb3i35b") != std::wstring_view::npos &&
      value.find(L"ensureRepeatOne") != std::wstring_view::npos) {
    return kSpotifyLonesomeRabbitGuardScript;
  }
  return script;
}

}  // namespace
}  // namespace hp
