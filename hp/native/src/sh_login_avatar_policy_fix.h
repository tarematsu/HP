#pragma once

namespace hp {

// Preserve whichever Stationhead autoplay policy is active before this final
// account-state bridge is installed. The helper is preprocessed while the
// existing StationheadAutoplayScript macro still names that policy.
inline std::wstring StationheadAutoplayScriptBeforeAvatarSettlement(
    const wchar_t* globalName,
    const wchar_t* messagePrefix) {
  return StationheadAutoplayScript(globalName, messagePrefix);
}

}  // namespace hp

#undef StationheadAutoplayScript

namespace hp {

// Login foregrounding is intentionally independent from the native statistics
// credential path. Since page-side auth capture is disabled, a successful login
// no longer produces stationhead-auth-ready by itself. Capture WebView2's native
// postMessage before earlier runtime policies wrap it, then use the actual
// top-right account avatar as the positive signed-in signal.
inline std::wstring StationheadAutoplayScriptAvatarSettlementFixed(
    const wchar_t* globalName,
    const wchar_t* messagePrefix) {
  const std::wstring base =
      StationheadAutoplayScriptBeforeAvatarSettlement(globalName, messagePrefix);

  std::wostringstream script;
  script << LR"JS(
(() => {
  const host = String(location.hostname || '').toLowerCase();
  if ((host !== 'stationhead.com' && !host.endsWith('.stationhead.com')) ||
      window.top !== window || window.__homepanelStationheadNativePost) {
    return;
  }
  const webview = window.chrome?.webview;
  if (!webview || typeof webview.postMessage !== 'function') return;
  window.__homepanelStationheadNativePost =
      webview.postMessage.bind(webview);
})()
)JS";
  script.push_back(L'\n');
  script.append(base);
  script.push_back(L'\n');
  script << LR"JS(
(() => {
  const host = String(location.hostname || '').toLowerCase();
  if ((host !== 'stationhead.com' && !host.endsWith('.stationhead.com')) ||
      window.top !== window || window.__homepanelStationheadAvatarSettlement) {
    return;
  }
  window.__homepanelStationheadAvatarSettlement = true;

  const nativePost = window.__homepanelStationheadNativePost;
  if (typeof nativePost !== 'function') return;
  const nativeTimeout = window.setTimeout.bind(window);
  const nativeClearTimeout = window.clearTimeout.bind(window);
  const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
  const avatarSelector =
      "img,picture,[data-testid*='avatar' i],[data-testid*='profile' i]," +
      "[class*='avatar' i],[aria-label*='avatar' i],[aria-label*='profile' i]," +
      "[aria-label*='account' i]";
  const credentialSelector =
      "input[type='password'],input[type='email'],input[autocomplete='username']," +
      "input[autocomplete='current-password']";
  const controlSelector =
      "button,[role='button'],a,input[type='button'],input[type='submit']," +
      "[aria-label],[data-testid],[tabindex]";
  const headingSelector = "h1,h2,h3,[role='heading']";
  const loginPattern =
      /^(log\s*in|sign\s*in|login|ログイン|サインイン)(?:\s+.*)?$/i;
  const connectMusicPattern = /^connect\s+music$/i;
  const loginMessage = ')JS"
         << messagePrefix
         << LR"JS(-login-required';

  let pageActive = true;
  let timer = 0;
  let avatarSince = 0;
  let anonymousSince = 0;
  let authenticatedReported = false;

  const visible = element => {
    if (!(element instanceof Element) || !element.isConnected ||
        element.getAttribute('aria-hidden') === 'true') {
      return false;
    }
    const rect = element.getBoundingClientRect?.();
    if (!rect || rect.width <= 2 || rect.height <= 2 || rect.right <= 0 ||
        rect.bottom <= 0 || rect.left >= innerWidth || rect.top >= innerHeight) {
      return false;
    }
    const style = getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden' &&
      Number(style.opacity || 1) > 0;
  };

  const labelOf = element => normalize([
    element?.getAttribute?.('aria-label'),
    element?.getAttribute?.('data-testid'),
    element?.getAttribute?.('title'),
    element?.getAttribute?.('alt'),
    element?.innerText,
    element?.textContent,
  ].filter(Boolean).join(' '));

  const topRightAccountAvatar = () => {
    const rightBoundary = Math.max(96, innerWidth * 0.60);
    for (const element of document.querySelectorAll(avatarSelector)) {
      if (!visible(element)) continue;
      const rect = element.getBoundingClientRect();
      if (rect.top < -4 || rect.top > 128 || rect.right < rightBoundary ||
          rect.width < 12 || rect.height < 12 ||
          rect.width > 112 || rect.height > 112) {
        continue;
      }
      if (/stationhead|logo/i.test(labelOf(element))) continue;
      return element;
    }
    return null;
  };

  const loginRoute = () =>
      /(^|\/)(login|signin|sign-in|auth)(?:\/|[?#]|$)/i.test(
          String(location.pathname || ''));

  const loginControlPresent = visibleOnly => {
    for (const element of document.querySelectorAll(controlSelector)) {
      const label = labelOf(element);
      const href = String(element.getAttribute?.('href') || '').toLowerCase();
      if (!loginPattern.test(label) &&
          !/(^|\/)(login|signin|sign-in)(?:\/|[?#]|$)/i.test(href)) {
        continue;
      }
      if (!visibleOnly || visible(element)) return true;
    }
    return false;
  };

  const strongAuthSurfaceVisible = () => {
    if (loginRoute()) return true;
    for (const element of document.querySelectorAll(credentialSelector)) {
      if (visible(element)) return true;
    }
    for (const heading of document.querySelectorAll(headingSelector)) {
      if (visible(heading) && connectMusicPattern.test(labelOf(heading))) return true;
    }
    return loginControlPresent(true);
  };

  const check = () => {
    if (!pageActive) return;
    const now = Date.now();
    if (strongAuthSurfaceVisible()) {
      avatarSince = 0;
      anonymousSince = 0;
      if (authenticatedReported) {
        authenticatedReported = false;
        try { nativePost(loginMessage); } catch (_) {}
      }
      return;
    }

    const avatar = topRightAccountAvatar();
    if (avatar) {
      anonymousSince = 0;
      if (!avatarSince) avatarSince = now;
      if (!authenticatedReported && now - avatarSince >= 3000) {
        authenticatedReported = true;
        try { nativePost({ type: 'stationhead-auth-ready' }); } catch (_) {}
      }
      return;
    }

    avatarSince = 0;
    if (authenticatedReported && loginControlPresent(false)) {
      if (!anonymousSince) anonymousSince = now;
      if (now - anonymousSince >= 3000) {
        authenticatedReported = false;
        anonymousSince = 0;
        try { nativePost(loginMessage); } catch (_) {}
      }
    } else {
      anonymousSince = 0;
    }
  };

  const schedule = (delay = 1000) => {
    if (!pageActive || timer) return;
    timer = nativeTimeout(() => {
      timer = 0;
      if (!pageActive) return;
      check();
      schedule();
    }, delay);
  };

  window.addEventListener('pagehide', () => {
    pageActive = false;
    if (timer) {
      nativeClearTimeout(timer);
      timer = 0;
    }
  }, true);
  window.addEventListener('pageshow', () => {
    pageActive = true;
    check();
    schedule(250);
  }, true);
  document.addEventListener('DOMContentLoaded', () => {
    check();
    schedule(250);
  }, { once: true });
  window.addEventListener('load', check, { once: true });
  check();
  schedule(250);
})()
)JS";
  return script.str();
}

}  // namespace hp

#define StationheadAutoplayScript StationheadAutoplayScriptAvatarSettlementFixed
