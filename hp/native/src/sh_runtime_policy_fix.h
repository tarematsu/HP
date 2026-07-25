#pragma once

namespace hp {

// The base autoplay script reacts to DOM changes, but an SPA can leave the same
// login control in place while authentication changes underneath it. Keep one
// low-frequency runtime check per Stationhead document while audio is active,
// and always recheck immediately after a newly captured authorization header.
inline std::wstring StationheadAutoplayScriptRuntimeFixed(
    const wchar_t* globalName, const wchar_t* messagePrefix) {
  std::wstring script = StationheadAutoplayScript(globalName, messagePrefix);
  std::wostringstream extension;
  extension << LR"JS(
(() => {
  const host = String(location.hostname || '').toLowerCase();
  if (host !== 'stationhead.com' && !host.endsWith('.stationhead.com')) return;
  if (window.)JS"
            << globalName
            << LR"JS(AuthRecheck) return;
  window.)JS"
            << globalName
            << LR"JS(AuthRecheck = true;
  const nativeTimeout = window.setTimeout.bind(window);
  let timer = 0;
  const scan = () => {
    try { window.)JS"
            << globalName
            << LR"JS(?.scan?.(0); } catch (_) {}
  };
  const playing = () => {
    if (typeof window.__homepanelAudioPlaying === 'boolean') {
      return window.__homepanelAudioPlaying;
    }
    if (navigator.mediaSession?.playbackState === 'playing') return true;
    return Array.from(document.querySelectorAll('audio,video')).some(element =>
      !element.paused && !element.ended && element.readyState >= 2);
  };
  const schedule = () => {
    if (timer) return;
    timer = nativeTimeout(() => {
      timer = 0;
      if (playing()) scan();
      schedule();
    }, 5000);
  };
  window.addEventListener('homepanel-stationhead-auth-ready', scan);
  schedule();
})()
)JS";
  script.push_back(L'\n');
  script.append(extension.str());
  return script;
}

// Window A's successful stats request is throttled for ten minutes, but that
// throttle must belong to the exact authorization value that was validated.
// A 401 invalidates that authorization; a 403 can be endpoint permission or a
// temporary policy response and must not discard the playback session token.
inline std::wstring StationheadApiPlayStatsScriptRuntimeFixed(int channelId) {
  std::wostringstream script;
  script << LR"JS(
(() => {
  const post = message => {
    try { window.chrome?.webview?.postMessage(message); } catch (_) {}
  };
  const resetSuccessThrottle = () => {
    window.__homepanelStationheadPlayStatsSuccessAt = 0;
    window.__homepanelStationheadPlayStatsAuthorization = '';
  };
  const headers = window.__homepanelStationheadAuthHeaders;
  if (!headers?.authorization) {
    resetSuccessThrottle();
    post({ type: 'stationhead-play-stats-error', error: 'no-auth-header' });
    return false;
  }
  const lastSuccessAt = Number(window.__homepanelStationheadPlayStatsSuccessAt || 0);
  const lastSuccessAuthorization = String(
    window.__homepanelStationheadPlayStatsAuthorization || '');
  if (lastSuccessAt > 0 &&
      lastSuccessAuthorization === headers.authorization &&
      Date.now() - lastSuccessAt < 10 * 60 * 1000) {
    return false;
  }
  const url = 'https://production1.stationhead.com/me/channel/)JS"
         << channelId << LR"JS(/streakStats';
  fetch(url, {
    method: 'GET',
    credentials: 'include',
    cache: 'no-store',
    headers: Object.assign({ accept: 'application/json' }, headers),
  }).then(async response => {
    if (response.status === 401) {
      resetSuccessThrottle();
      window.__homepanelStationheadRejectedAuthorization = headers.authorization;
      window.__homepanelStationheadAuthHeaders = null;
      post({ type: 'stationhead-play-stats-auth-failed', status: response.status });
      return null;
    }
    if (response.status === 403) {
      resetSuccessThrottle();
      post({ type: 'stationhead-play-stats-error', error: 'forbidden' });
      return null;
    }
    if (!response.ok) throw new Error('http-' + response.status);
    return response.json();
  }).then(data => {
    if (data) {
      window.__homepanelStationheadPlayStatsSuccessAt = Date.now();
      window.__homepanelStationheadPlayStatsAuthorization = headers.authorization;
      post({ type: 'stationhead-play-stats', data, source: 'authenticated-api' });
    }
  }).catch(error => {
    post({ type: 'stationhead-play-stats-error', error: String(error?.message || error) });
  });
  return true;
})()
)JS";
  return script.str();
}

}  // namespace hp

// These macros are intentionally defined after the wrappers. Calls compiled
// after the precompiled-header boundary use the fixed runtime policy, while the
// wrapper bodies above still refer to the original policy functions.
#define StationheadAutoplayScript StationheadAutoplayScriptRuntimeFixed
#define StationheadApiPlayStatsScript StationheadApiPlayStatsScriptRuntimeFixed
