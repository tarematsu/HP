#pragma once
#include "common.h"
#include "sh_data_acquisition_resource_policy_fix.h"
#include "sh_startup_resource_reduction_policy_fix.h"
#include "sh_playback_resource_policy_fix.h"

namespace hp {

// Native response observation owns play-count credentials. Keep the historical
// registration handshake in ConfigureWebView, but inject no fetch/XHR wrappers
// into Stationhead itself.
inline std::wstring StationheadAuthCaptureScriptDisabled() {
  return L"void 0";
}

// The playback WebView is intentionally kept in a tiny background viewport.
// Stationhead's desktop Log in anchor is consequently CSS-hidden there even
// though the control remains in the DOM and accurately reflects guest state.
// Treat that semantic control as an interactive requirement immediately; once
// the native host is foregrounded the same control becomes visually available.
inline std::wstring StationheadAutoplayScriptForegroundLogin(
    const wchar_t* globalName,
    const wchar_t* messagePrefix) {
  std::wstring script = StationheadAutoplayScript(globalName, messagePrefix);
  std::wstring loginProbe = LR"JS(
(() => {
  const host = String(location.hostname || '').toLowerCase();
  if (host !== 'stationhead.com' && !host.endsWith('.stationhead.com')) return;
  if (window.__homepanelStationheadForegroundLoginProbe) return;
  window.__homepanelStationheadForegroundLoginProbe = true;
  const prefix = ')JS";
  loginProbe.append(messagePrefix ? messagePrefix : L"stationhead");
  loginProbe.append(LR"JS(';
  const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
  const selector = "button,[role='button'],a,input[type='button'],input[type='submit']";
  const loginPattern = /^(log\s*in|sign\s*in|login)(?:\s+.*)?$/i;
  const labelsOf = element => [
    element?.innerText,
    element?.textContent,
    element?.getAttribute?.('aria-label'),
    element?.getAttribute?.('title'),
    element?.getAttribute?.('value')
  ].map(normalize).filter(Boolean);
  const hasLoginDestination = element => {
    if (element?.tagName !== 'A') return false;
    const raw = element.getAttribute?.('href') || '';
    if (!raw) return false;
    try {
      const target = new URL(raw, location.href);
      const targetHost = String(target.hostname || '').toLowerCase();
      if (target.protocol !== 'https:' ||
          (targetHost !== 'stationhead.com' && !targetHost.endsWith('.stationhead.com'))) {
        return false;
      }
      return /^\/(sign-in|login)(?:\/|$)/i.test(target.pathname || '');
    } catch (_) {
      return false;
    }
  };
  let reported = false;
  let observer = null;
  const report = () => {
    if (reported) return;
    reported = true;
    observer?.disconnect?.();
    try { window.chrome?.webview?.postMessage(prefix + '-login-required'); } catch (_) {}
  };
  const scan = () => {
    if (reported || !document.body) return;
    for (const element of document.querySelectorAll(selector)) {
      if (hasLoginDestination(element) ||
          labelsOf(element).some(label => loginPattern.test(label))) {
        report();
        return;
      }
    }
  };
  const start = () => {
    scan();
    if (reported || !document.documentElement) return;
    observer = new MutationObserver(scan);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['aria-label', 'title', 'value', 'href', 'class']
    });
  };
  if (document.documentElement) start();
  else document.addEventListener('DOMContentLoaded', start, { once: true });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) scan();
  });
})()
)JS");
  script.push_back(L'\n');
  script.append(loginProbe);
  return script;
}

// Media boundaries never initiate navigation. Window A uses the native
// 55-minute clock and Window B uses the native 54-minute clock instead.
inline std::wstring StationheadTrackBoundaryScript(const wchar_t*) {
  return {};
}

}  // namespace hp

// Keep legacy trusted-origin track-ended messages harmless during an in-place
// update. Only the independent elapsed-time refresh policy may reload a player.
#define HandleTrackEnded(...) ((void)0)

#undef StationheadAuthCaptureScript
#define StationheadAuthCaptureScript StationheadAuthCaptureScriptDisabled

#undef StationheadAutoplayScript
#define StationheadAutoplayScript StationheadAutoplayScriptForegroundLogin
