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

// Treat a visible Stationhead `Log in` control as an interactive requirement
// immediately, even while WebView2 still reports audible playback. The native
// message handler already latches loginRequired_ and calls ShowForLogin(); this
// document observer only makes that signal unconditional and independent of
// the playback state or the older 15-second autoplay scan grace period.
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
  const selector = "button,[role='button'],a,input[type='button'],input[type='submit'],[aria-label],[data-testid],[tabindex]";
  const loginPattern = /^(log\s*in|sign\s*in|login)(?:\s+.*)?$/i;
  const labelsOf = element => [
    element?.innerText,
    element?.textContent,
    element?.getAttribute?.('aria-label'),
    element?.getAttribute?.('title'),
    element?.getAttribute?.('value'),
    element?.getAttribute?.('data-testid')
  ].map(normalize).filter(Boolean);
  const visible = element => {
    if (!element || element.getAttribute?.('aria-hidden') === 'true') return false;
    const rect = element.getBoundingClientRect?.();
    if (!rect || rect.width <= 2 || rect.height <= 2) return false;
    for (let node = element; node instanceof Element; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden' ||
          Number(style.opacity || 1) <= 0) return false;
    }
    return true;
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
      if (!visible(element)) continue;
      if (labelsOf(element).some(label => loginPattern.test(label))) {
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
      attributeFilter: ['aria-label', 'data-testid', 'title', 'value', 'style', 'class']
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
