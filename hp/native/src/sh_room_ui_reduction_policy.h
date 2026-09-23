#pragma once

namespace hp {

// Playback-only Stationhead room presentation. The room stays fully interactive
// until media is actually playing so account and playback interaction remains
// usable. Once playback reaches `playing`, rendering of the app tree is
// suppressed without pausing/removing media or changing document visibility.
// Any playback/recovery edge immediately restores the room UI.
//
// This script also claims the historical audio-only sentinel before the legacy
// autoplay wrapper runs. That prevents its document-wide DOM scanner from being
// installed; room reduction is CSS + media events only.
inline std::wstring StationheadRoomUiReductionScript() {
  static constexpr wchar_t kScript[] = LR"JS(
(() => {
  const host = String(location.hostname || '').toLowerCase();
  if (host !== 'stationhead.com' && !host.endsWith('.stationhead.com')) return;

  // Disable the legacy semantic DOM scanner on every Stationhead surface.
  // Account-state detection is independent and does not depend on that scanner.
  window.__homepanelStationheadAudioOnlyUi = true;
  try {
    window.__homepanelStationheadAudioOnlyUiObserver?.disconnect?.();
    window.__homepanelStationheadAudioOnlyUiObserver = null;
  } catch (_) {}

  const path = String(location.pathname || '/').replace(/\/+$/, '') || '/';
  const parts = path.split('/').filter(Boolean);
  const reserved = new Set([
    'home', 'sign-in', 'sign-up', 'search', 'discover', 'settings',
    'profile', 'account', 'terms', 'privacy', 'api'
  ]);
  const singleSegmentRoom =
      parts.length === 1 && !reserved.has(parts[0].toLowerCase());
  const channelRoom =
      parts.length === 2 && parts[0].toLowerCase() === 'c' && parts[1].length > 0;
  if (!singleSegmentRoom && !channelRoom) return true;

  const styleId = '__homepanelStationheadRoomUiReduction';
  const playbackAttribute = 'data-homepanel-stationhead-playback-only';
  const install = () => {
    if (document.getElementById(styleId)) return true;
    const root = document.head || document.documentElement;
    if (!root) return false;

    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      /* Static room cleanup before playback. Keep selectors tied to explicit
         presentation semantics. Never hide generic structural containers or
         reusable button classes because recovery controls can be mounted there. */
      [data-testid*='chat' i], [id*='chat' i], [class*='chat' i], [aria-label*='chat' i],
      [data-testid*='thread' i], [id*='thread' i], [class*='thread' i], [aria-label*='thread' i],
      [data-testid*='listener' i], [id*='listener' i], [class*='listener' i], [aria-label*='listener' i],
      [data-testid*='audience' i], [id*='audience' i], [class*='audience' i], [aria-label*='audience' i],
      [data-testid*='comment' i], [id*='comment' i], [class*='comment' i], [aria-label*='comment' i],
      [data-testid*='reaction' i], [id*='reaction' i], [class*='reaction' i], [aria-label*='reaction' i],
      [data-testid*='gift' i], [id*='gift' i], [class*='gift' i], [aria-label*='gift' i],
      [data-testid*='share' i], [id*='share' i], [class*='share' i], [aria-label*='share' i],
      a[href*='/threads' i], a[href*='/chat' i],
      textarea,
      button[aria-label='Add a GIF'],
      button[aria-label*='react' i],

      /* Explicit room action/presentation contracts only. */
      a[aria-label='Open threads'],
      a[href$='/threads'],
      button[aria-label='View streaming party details'],
      button[aria-label='Copy link'],

      /* Audited chat message/composer contracts. */
      [aria-label^='View '],
      button[aria-label^='Reply to '],
      textarea[class~='min-w-0'][class~='flex-1'][class~='resize-none'][class~='bg-transparent'],
      aside:has(textarea[class~='min-w-0'][class~='flex-1'][class~='resize-none'][class~='bg-transparent']),
      [role='complementary']:has(textarea[class~='min-w-0'][class~='flex-1'][class~='resize-none'][class~='bg-transparent']),

      /* Hide only explicit mini-player controls; keep footer itself available
         because Stationhead can mount recovery actions in structural shells. */
      button[aria-label='Toggle Mute'],
      [aria-label='Volume'],
      input[type='range'] {
        display: none !important;
        visibility: hidden !important;
        pointer-events: none !important;
        content-visibility: hidden !important;
      }

      /* During confirmed playback the Stationhead document becomes an audio
         engine rather than a rendered app. Keep DOM/JS alive, but skip layout
         and paint for the app tree. Media continues because neither the media
         element nor document visibility/playback state is changed. */
      html[${playbackAttribute}='true'] body {
        background: #000 !important;
        overflow: hidden !important;
      }
      html[${playbackAttribute}='true'] body > :not(script):not(style) {
        visibility: hidden !important;
        pointer-events: none !important;
        content-visibility: hidden !important;
        contain: strict !important;
      }
    `;
    root.appendChild(style);
    return true;
  };

  const setPlaybackOnly = enabled => {
    const root = document.documentElement;
    if (!root) return;
    if (enabled) root.setAttribute(playbackAttribute, 'true');
    else root.removeAttribute(playbackAttribute);
  };
  const onMediaState = event => {
    const media = event.target;
    if (!media?.matches?.('audio,video')) return;
    if (event.type === 'playing') {
      setPlaybackOnly(true);
      return;
    }
    setPlaybackOnly(false);
  };

  // Media events are captured because they do not all bubble. No polling,
  // DOM observer, geometry read or recurring timer is required.
  document.addEventListener('playing', onMediaState, true);
  for (const eventName of [
      'pause', 'waiting', 'stalled', 'ended', 'error', 'emptied', 'abort']) {
    document.addEventListener(eventName, onMediaState, true);
  }
  window.addEventListener('pagehide', () => setPlaybackOnly(false), true);

  if (!install()) {
    document.addEventListener('DOMContentLoaded', install, { once: true });
  }
  return true;
})()
)JS";
  return kScript;
}

}  // namespace hp
