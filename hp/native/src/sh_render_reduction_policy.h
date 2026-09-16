#pragma once

namespace hp {

// CSS-only rendering reduction for Stationhead. This policy owns paint and
// presentation effects that are safe on every Stationhead page; room-specific
// audited selectors live in sh_room_ui_reduction_policy.h.
inline std::wstring StationheadRenderReductionScript() {
  static constexpr wchar_t kScript[] = LR"JS(
(() => {
  const host = String(location.hostname || '').toLowerCase();
  if (host !== 'stationhead.com' && !host.endsWith('.stationhead.com')) return;
  const styleId = '__homepanelStationheadRenderReduction';
  const install = () => {
    if (document.getElementById(styleId)) return true;
    const root = document.head || document.documentElement;
    if (!root) return false;
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      *, *::before, *::after {
        animation: none !important;
        animation-play-state: paused !important;
        transition: none !important;
        scroll-behavior: auto !important;
        box-shadow: none !important;
        filter: none !important;
        backdrop-filter: none !important;
        text-shadow: none !important;
        will-change: auto !important;
        view-transition-name: none !important;
      }
      picture, img,
      video, canvas, svg[aria-hidden='true'],
      marquee,
      [data-testid*='chat' i], [id*='chat' i], [class*='chat' i], [aria-label*='chat' i],
      [data-testid*='comment' i], [id*='comment' i], [class*='comment' i], [aria-label*='comment' i],
      [data-testid*='thread' i], [id*='thread' i], [class*='thread' i], [aria-label*='thread' i],
      [data-testid*='gift' i], [id*='gift' i], [aria-label*='gift' i],
      [data-testid*='reaction' i], [id*='reaction' i], [aria-label*='reaction' i],
      [data-testid*='emoji' i], [id*='emoji' i], [aria-label*='emoji' i],
      [data-testid*='tip' i], [id*='tip' i], [aria-label*='tip' i],
      [data-testid*='tipping' i], [id*='tipping' i], [aria-label*='tipping' i],
      [data-testid*='share' i], [id*='share' i], [aria-label*='share' i],
      [data-testid*='invite' i], [id*='invite' i], [aria-label*='invite' i],
      [data-testid*='social' i], [id*='social' i], [aria-label*='social' i],
      [data-testid*='listener' i], [id*='listener' i], [aria-label*='listener' i],
      [data-testid*='audience' i], [id*='audience' i], [aria-label*='audience' i],
      [data-testid*='leaderboard' i], [id*='leaderboard' i], [aria-label*='leaderboard' i],
      [data-testid*='ranking' i], [id*='ranking' i], [aria-label*='ranking' i],
      [data-testid*='rank-' i], [id*='rank-' i], [aria-label*='rank ' i],
      [data-testid*='stats' i], [id*='stats' i], [aria-label*='stats' i],
      [data-testid*='streak' i], [id*='streak' i], [aria-label*='streak' i],
      [data-testid*='play-count' i], [id*='play-count' i], [aria-label*='play count' i],
      [data-testid*='playcount' i], [id*='playcount' i], [aria-label*='total plays' i],
      [data-testid*='total-plays' i], [id*='total-plays' i],
      [data-testid*='totalplays' i], [id*='totalplays' i],
      [data-testid*='now-playing' i], [id*='now-playing' i], [class*='now-playing' i],
      [data-testid*='track-card' i], [id*='track-card' i], [class*='track-card' i],
      [data-testid*='current-track' i], [id*='current-track' i], [class*='current-track' i],
      [data-testid*='current-song' i], [id*='current-song' i], [class*='current-song' i],
      [data-testid*='song-card' i], [id*='song-card' i], [class*='song-card' i],
      [data-testid*='waveform' i], [id*='waveform' i], [class*='waveform' i], [aria-label*='waveform' i],
      [data-testid*='visualizer' i], [id*='visualizer' i], [class*='visualizer' i], [aria-label*='visualizer' i],
      [data-testid*='equalizer' i], [id*='equalizer' i], [class*='equalizer' i], [aria-label*='equalizer' i],
      [data-testid*='spectrum' i], [id*='spectrum' i], [class*='spectrum' i], [aria-label*='spectrum' i],
      [data-testid*='lottie' i], [id*='lottie' i], [class*='lottie' i],
      [data-testid*='confetti' i], [id*='confetti' i], [class*='confetti' i],
      [data-testid*='sparkle' i], [id*='sparkle' i], [class*='sparkle' i],
      [data-testid*='marquee' i], [id*='marquee' i], [class*='marquee' i],
      [data-testid*='ticker' i], [id*='ticker' i], [class*='ticker' i],
      a[href*='/chat' i], a[href*='/leaderboard' i] {
        display: none !important;
        visibility: hidden !important;
        pointer-events: none !important;
        content-visibility: hidden !important;
        contain: strict !important;
      }
    `;
    root.appendChild(style);
    return true;
  };
  if (!install()) {
    document.addEventListener('DOMContentLoaded', install, { once: true });
  }
  return true;
})()
)JS";
  return kScript;
}

}  // namespace hp
