#pragma once
#include "common.h"

namespace hp {

inline std::wstring StationheadTrackBoundaryScript(const wchar_t* messagePrefix) {
  static constexpr wchar_t kTemplate[] = LR"JS(;(() => {
  const host = String(location.hostname || '').toLowerCase();
  if (host !== 'stationhead.com' && !host.endsWith('.stationhead.com')) return;
  if (window.__homepanelStationheadTrackBoundaryBridge) return;
  window.__homepanelStationheadTrackBoundaryBridge = true;

  const nativeTimeout = window.setTimeout.bind(window);
  const nativeClearTimeout = window.clearTimeout.bind(window);
  const playbackMarkerKey = '__homepanelStationheadRecentPlayback:{{PREFIX}}';
  const recoveryMarkerMaxAgeMs = 30 * 60 * 1000;
  const recoveryDeadlineAt = Date.now() + 30 * 1000;
  let pageActive = true;
  let playedMedia = new WeakSet();
  let recoveryTimer = 0;
  let recoveryInFlight = false;

  // A full navigation creates a new document and loses the page's in-memory
  // playback state. Keep only a short-lived session marker so the replacement
  // document can distinguish an established listener from a first-time/login
  // page and safely resume the already selected live media element.
  const markRecentPlayback = () => {
    try { sessionStorage.setItem(playbackMarkerKey, String(Date.now())); } catch (_) {}
  };
  const hasRecentPlayback = () => {
    try {
      const markedAt = Number(sessionStorage.getItem(playbackMarkerKey) || 0);
      const age = Date.now() - markedAt;
      return Number.isFinite(markedAt) && markedAt > 0 && age >= 0 &&
        age <= recoveryMarkerMaxAgeMs;
    } catch (_) {
      return false;
    }
  };
  const mediaIsPlaying = media => media instanceof HTMLMediaElement &&
    !media.paused && !media.ended &&
    media.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA;
  const anyMediaPlaying = () => {
    if (window.__homepanelAudioPlaying === true) return true;
    return Array.from(document.querySelectorAll('audio,video')).some(mediaIsPlaying);
  };
  const hasSource = media => Boolean(
    media.currentSrc || media.getAttribute?.('src') ||
      media.querySelector?.('source[src]'));

  const schedulePlaybackRecovery = delay => {
    if (!pageActive || recoveryTimer || Date.now() >= recoveryDeadlineAt ||
        !hasRecentPlayback() || anyMediaPlaying()) return;
    recoveryTimer = nativeTimeout(attemptPlaybackRecovery, delay);
  };
  const attemptPlaybackRecovery = () => {
    recoveryTimer = 0;
    if (!pageActive || recoveryInFlight || Date.now() >= recoveryDeadlineAt ||
        !hasRecentPlayback() || anyMediaPlaying()) return;
    const candidates = Array.from(document.querySelectorAll('audio,video'))
      .filter(media => media instanceof HTMLMediaElement && media.isConnected &&
        media.paused && !media.ended && hasSource(media) &&
        media.readyState >= HTMLMediaElement.HAVE_METADATA)
      .sort((left, right) => {
        const readiness = right.readyState - left.readyState;
        if (readiness) return readiness;
        return Number(right.tagName === 'AUDIO') - Number(left.tagName === 'AUDIO');
      })
      .slice(0, 3);
    if (!candidates.length) {
      schedulePlaybackRecovery(500);
      return;
    }
    try { window.__homepanelStationheadVolumeApply?.(); } catch (_) {}
    recoveryInFlight = true;
    const playFirstAvailable = async () => {
      for (const media of candidates) {
        try {
          await media.play();
          if (mediaIsPlaying(media)) return true;
        } catch (_) {}
      }
      return false;
    };
    playFirstAvailable().finally(() => {
      recoveryInFlight = false;
      if (anyMediaPlaying()) markRecentPlayback();
      else schedulePlaybackRecovery(1000);
    });
  };

  window.addEventListener('pagehide', () => {
    pageActive = false;
    playedMedia = new WeakSet();
    if (recoveryTimer) {
      nativeClearTimeout(recoveryTimer);
      recoveryTimer = 0;
    }
  });
  window.addEventListener('pageshow', () => {
    pageActive = true;
    schedulePlaybackRecovery(0);
  });

  const rememberPlayedMedia = event => {
    if (pageActive && event.target instanceof HTMLMediaElement) {
      playedMedia.add(event.target);
      markRecentPlayback();
    }
  };
  document.addEventListener('play', rememberPlayedMedia, true);
  document.addEventListener('playing', rememberPlayedMedia, true);
  document.addEventListener('loadedmetadata', () => schedulePlaybackRecovery(0), true);
  document.addEventListener('canplay', () => schedulePlaybackRecovery(0), true);
  document.addEventListener('ended', event => {
    const media = event.target;
    if (!(media instanceof HTMLMediaElement) || !playedMedia.has(media)) return;
    if (!pageActive) {
      playedMedia.delete(media);
      return;
    }

    // Stationhead may reuse the same element for the next track before the old
    // ended event is delivered. Keep tracking it and do not interrupt the new track.
    const sameMediaRestarted = !media.paused && !media.ended &&
      media.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA;
    if (sameMediaRestarted) return;

    // Ignore stale/auxiliary media ending while another Stationhead media
    // element is already carrying the next track. Refresh at an actual gap.
    const anotherMediaIsPlaying = Array.from(document.querySelectorAll('audio,video')).some(
      candidate => candidate !== media && !candidate.paused && !candidate.ended &&
        candidate.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA);
    playedMedia.delete(media);
    if (anotherMediaIsPlaying) return;

    try {
      window.chrome?.webview?.postMessage('{{PREFIX}}-track-ended');
    } catch (_) {}
  }, true);

  // After the native 52-minute boundary navigation, the new document can have
  // a valid current media source that remains paused until Stationhead advances
  // to the following track. Resume that source immediately instead of waiting
  // for the next track transition or rebuilding the WebView.
  schedulePlaybackRecovery(0);
})()
)JS";
  // This script is appended after the existing autoplay IIFE. The leading
  // semicolon prevents automatic semicolon insertion from treating it as a
  // call on the previous IIFE's return value.
  static_assert(kTemplate[0] == L';');
  std::wstring script = kTemplate;
  constexpr std::wstring_view placeholder = L"{{PREFIX}}";
  const std::wstring replacement = messagePrefix ? messagePrefix : L"stationhead";
  for (size_t at = script.find(placeholder); at != std::wstring::npos;
       at = script.find(placeholder, at + replacement.size())) {
    script.replace(at, placeholder.size(), replacement);
  }
  return script;
}

}  // namespace hp
