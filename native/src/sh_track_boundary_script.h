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
  const playbackLeaseKey = '__homepanelStationheadRecentPlayback:v2:{{PREFIX}}';
  const playbackLeaseMaxAgeMs = 30 * 60 * 1000;
  const playbackRoute = String(location.origin || '') + String(location.pathname || '/');
  let pageActive = true;
  let playedMedia = new WeakSet();
  let recoveryTimer = 0;
  let recoveryInFlight = false;

  // WebView reconstruction destroys sessionStorage together with the browsing
  // context. Keep a short-lived, route-scoped lease in the persistent profile
  // so a replacement WebView can continue recovering the same established
  // station without enabling autoplay on unrelated/login routes.
  const markRecentPlayback = () => {
    try {
      localStorage.setItem(playbackLeaseKey, `${Date.now()}\n${playbackRoute}`);
    } catch (_) {}
  };
  const hasRecentPlayback = () => {
    try {
      const value = String(localStorage.getItem(playbackLeaseKey) || '');
      const separator = value.indexOf('\n');
      if (separator <= 0 || value.slice(separator + 1) !== playbackRoute) return false;
      const markedAt = Number(value.slice(0, separator));
      const age = Date.now() - markedAt;
      return Number.isFinite(markedAt) && markedAt > 0 && age >= 0 &&
        age <= playbackLeaseMaxAgeMs;
    } catch (_) {
      return false;
    }
  };
  const mediaIsPlaying = media => media instanceof HTMLMediaElement &&
    !media.paused && !media.ended &&
    media.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA;
  const anyMediaPlaying = () => {
    // When available, the native WebView2 audio signal is authoritative. A
    // media element can report paused=false while its DRM/audio pipeline is
    // stalled and producing no sound.
    if (typeof window.__homepanelAudioPlaying === 'boolean') {
      return window.__homepanelAudioPlaying;
    }
    return Array.from(document.querySelectorAll('audio,video')).some(mediaIsPlaying);
  };
  const hasSource = media => Boolean(
    media.currentSrc || media.getAttribute?.('src') ||
      media.querySelector?.('source[src]'));

  const schedulePlaybackRecovery = delay => {
    if (!pageActive || recoveryTimer || !hasRecentPlayback() || anyMediaPlaying()) return;
    recoveryTimer = nativeTimeout(attemptPlaybackRecovery, Math.max(0, delay || 0));
  };
  const attemptPlaybackRecovery = () => {
    recoveryTimer = 0;
    if (!pageActive || recoveryInFlight || !hasRecentPlayback() || anyMediaPlaying()) return;
    const candidates = Array.from(document.querySelectorAll('audio,video'))
      .filter(media => media instanceof HTMLMediaElement && media.isConnected &&
        !media.ended && hasSource(media) &&
        media.readyState >= HTMLMediaElement.HAVE_METADATA)
      .sort((left, right) => {
        const paused = Number(right.paused) - Number(left.paused);
        if (paused) return paused;
        const readiness = right.readyState - left.readyState;
        if (readiness) return readiness;
        return Number(right.tagName === 'AUDIO') - Number(left.tagName === 'AUDIO');
      })
      .slice(0, 3);
    if (!candidates.length) {
      schedulePlaybackRecovery(2'000);
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
      else schedulePlaybackRecovery(5'000);
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
    }
  };
  const rememberConfirmedPlayback = event => {
    rememberPlayedMedia(event);
    if (!pageActive || !(event.target instanceof HTMLMediaElement)) return;
    markRecentPlayback();
    if (recoveryTimer) {
      nativeClearTimeout(recoveryTimer);
      recoveryTimer = 0;
    }
  };
  document.addEventListener('play', rememberPlayedMedia, true);
  document.addEventListener('playing', rememberConfirmedPlayback, true);
  for (const eventName of ['loadedmetadata', 'canplay']) {
    document.addEventListener(eventName, () => schedulePlaybackRecovery(0), true);
  }
  for (const eventName of ['pause', 'stalled', 'waiting', 'error', 'emptied']) {
    document.addEventListener(eventName, () => schedulePlaybackRecovery(1'000), true);
  }
  document.addEventListener('ended', event => {
    schedulePlaybackRecovery(1'000);
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

  // Recovery remains event-driven and lightly retried for the lifetime of the
  // short lease. This covers multiple track changes and a native WebView rebuild
  // instead of abandoning recovery after one fixed 30-second window.
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
