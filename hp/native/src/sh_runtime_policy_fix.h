#pragma once

namespace hp {

// The base autoplay script reacts to DOM changes, but an SPA can leave the same
// login control in place while authentication changes underneath it. Add a
// document-lifetime message gate, distinguish a blocking login surface from a
// generic header link, and keep one low-frequency check while audio is active.
inline std::wstring StationheadAutoplayScriptRuntimeFixed(
    const wchar_t* globalName, const wchar_t* messagePrefix) {
  std::wstring script = StationheadAutoplayScript(globalName, messagePrefix);
  std::wostringstream extension;
  extension << LR"JS(
(() => {
  const host = String(location.hostname || '').toLowerCase();
  const webview = window.chrome?.webview;
  const nativePost = webview?.postMessage?.bind(webview);
  const topLevelStationhead =
    (host === 'stationhead.com' || host.endsWith('.stationhead.com')) &&
    window.top === window;
  if (!topLevelStationhead) {
    // AddScriptToExecuteOnDocumentCreated also runs in child frames and after an
    // external top-level navigation. Remove the page-to-native channel before
    // either document can emit Stationhead-shaped state messages.
    if (webview && nativePost) {
      const blockedPost = () => undefined;
      try { webview.postMessage = blockedPost; } catch (_) {}
      try {
        Object.defineProperty(webview, 'postMessage', {
          configurable: false,
          writable: false,
          value: blockedPost,
        });
      } catch (_) {}
    }
    return;
  }
  if (window.)JS"
            << globalName
            << LR"JS(AuthRecheck) return;
  window.)JS"
            << globalName
            << LR"JS(AuthRecheck = true;
  const nativeTimeout = window.setTimeout.bind(window);
  const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
  const selector = "button,[role='button'],a,input[type='button'],input[type='submit'],[aria-label],[data-testid],[tabindex]";
  const credentialSelector = "input[type='password'],input[type='email'],input[autocomplete='username'],input[autocomplete='current-password']";
  const loginPattern = /^(log\s*in|sign\s*in|login|ログイン|サインイン)(?:\s+.*)?$/i;
  const visible = element => {
    if (!element || element.disabled || element.getAttribute?.('aria-disabled') === 'true' ||
        element.getAttribute?.('aria-hidden') === 'true') return false;
    const rect = element.getBoundingClientRect?.();
    if (!rect || rect.width <= 2 || rect.height <= 2) return false;
    const style = getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden' &&
      Number(style.opacity || 1) > 0 && style.pointerEvents !== 'none';
  };
  const labelOf = element => [
    element?.innerText,
    element?.getAttribute?.('aria-label'),
    element?.textContent,
    element?.getAttribute?.('title'),
    element?.getAttribute?.('value'),
    element?.getAttribute?.('data-testid'),
  ].map(normalize).find(Boolean) || '';
  const blockingLoginVisible = () => {
    const loginRoute = /(^|\/)(login|signin|sign-in|auth)(\/|$)/i.test(
      String(location.pathname || ''));
    for (const element of document.querySelectorAll(selector)) {
      if (!visible(element) || !loginPattern.test(labelOf(element))) continue;
      const shell = element.closest?.(
        "form,[role='dialog'],[aria-modal='true'],[data-testid*='login' i],[id*='login' i]");
      if (loginRoute || shell?.matches?.("form,[role='dialog'],[aria-modal='true']") ||
          shell?.querySelector?.(credentialSelector)) {
        return true;
      }
    }
    return false;
  };
  const playing = () => {
    if (typeof window.__homepanelAudioPlaying === 'boolean') {
      return window.__homepanelAudioPlaying;
    }
    if (navigator.mediaSession?.playbackState === 'playing') return true;
    return Array.from(document.querySelectorAll('audio,video')).some(element =>
      !element.paused && !element.ended && element.readyState >= 2);
  };
  const loginMessage = ')JS"
            << messagePrefix
            << LR"JS(-login-required';
  let pageActive = true;
  let robustLoginReported = false;
  let loginMissingSince = 0;
  let timer = 0;
  const updateBlockingLogin = () => {
    const blocking = blockingLoginVisible();
    const now = Date.now();
    if (blocking) {
      loginMissingSince = 0;
      window.__homepanelStationheadBlockingLoginVisible = true;
      if (!robustLoginReported && pageActive && nativePost) {
        robustLoginReported = true;
        nativePost(loginMessage);
      }
      return true;
    }
    if (!loginMissingSince) loginMissingSince = now;
    if (now - loginMissingSince >= 3000) {
      window.__homepanelStationheadBlockingLoginVisible = false;
      robustLoginReported = false;
    }
    return false;
  };
  if (webview && nativePost) {
    try {
      webview.postMessage = message => {
        if (!pageActive) return;
        if (message === loginMessage) {
          updateBlockingLogin();
          return;
        }
        if (message && typeof message === 'object' &&
            message.type === 'stationhead-auth-ready') {
          nativeTimeout(() => {
            if (pageActive) nativePost(message);
          }, 0);
          return;
        }
        return nativePost(message);
      };
    } catch (_) {}
  }
  const baseScan = () => {
    try { window.)JS"
            << globalName
            << LR"JS(?.scan?.(0); } catch (_) {}
  };
  const scan = () => {
    baseScan();
    updateBlockingLogin();
  };
  const schedule = () => {
    if (timer) return;
    timer = nativeTimeout(() => {
      timer = 0;
      if (pageActive) {
        if (playing()) baseScan();
        updateBlockingLogin();
      }
      schedule();
    }, 5000);
  };
  window.addEventListener('pagehide', () => { pageActive = false; }, true);
  window.addEventListener('pageshow', () => {
    pageActive = true;
    scan();
  }, true);
  window.addEventListener('homepanel-stationhead-auth-ready', () => {
    robustLoginReported = false;
    loginMissingSince = 0;
    scan();
  });
  updateBlockingLogin();
  schedule();
})()
)JS";
  script.push_back(L'\n');
  script.append(extension.str());
  return script;
}

// The page can complete a fresh login while retaining the same bearer token.
// The base capture policy deliberately rejects a token once a blocking login
// surface is observed, so release that rejection only after the refined login
// detector has observed a stable non-blocking page. The next page-owned request
// then revalidates and recaptures the same token without an extra API call.
inline std::wstring StationheadAuthCaptureScriptRuntimeFixed() {
  std::wstring script = StationheadAuthCaptureScript();
  script.append(LR"JS(
(() => {
  const host = String(location.hostname || '').toLowerCase();
  if ((host !== 'stationhead.com' && !host.endsWith('.stationhead.com')) ||
      window.top !== window) return;
  if (window.__homepanelStationheadAuthReuseFix) return;
  window.__homepanelStationheadAuthReuseFix = true;
  const releaseRejectedAuthorization = authorization => {
    if (!authorization ||
        authorization !== window.__homepanelStationheadRejectedAuthorization ||
        window.__homepanelStationheadBlockingLoginVisible !== false) {
      return;
    }
    window.__homepanelStationheadRejectedAuthorization = null;
  };
  const currentFetch = window.fetch ? window.fetch.bind(window) : null;
  if (currentFetch) {
    window.fetch = function(input, init) {
      try {
        const headers = new Headers((input && input.headers) || {});
        if (init && init.headers) {
          const initHeaders = new Headers(init.headers);
          initHeaders.forEach((value, name) => headers.set(name, value));
        }
        releaseRejectedAuthorization(headers.get('authorization') || '');
      } catch (_) {}
      return currentFetch(input, init);
    };
  }
  const NativeXhr = window.XMLHttpRequest;
  if (NativeXhr) {
    const currentSend = NativeXhr.prototype.send;
    NativeXhr.prototype.send = function(...args) {
      try {
        releaseRejectedAuthorization(this.__homepanelHeaders?.authorization || '');
      } catch (_) {}
      return currentSend.apply(this, args);
    };
  }
})()
)JS");
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
#define StationheadAuthCaptureScript StationheadAuthCaptureScriptRuntimeFixed
#define StationheadAutoplayScript StationheadAutoplayScriptRuntimeFixed
#define StationheadApiPlayStatsScript StationheadApiPlayStatsScriptRuntimeFixed
