#pragma once

#include "sh_polling_policy.h"

namespace hp {

inline std::wstring StationheadMediaProgressWatchdogScript() {
  static constexpr wchar_t kScript[] = LR"JS(
(() => {
  const host = String(location.hostname || '').toLowerCase();
  if ((host !== 'stationhead.com' && !host.endsWith('.stationhead.com')) ||
      window.top !== window) return;
  if (window.__homepanelStationheadMediaProgressWatchdog) return;
  window.__homepanelStationheadMediaProgressWatchdog = true;

  const nativeSetInterval = window.setInterval.bind(window);
  const nativeClearInterval = window.clearInterval.bind(window);
  const reloadKey = '__homepanelStationheadMediaStallReloadAt';
  const sampleIntervalMs = 15 * 1000;
  const stallThresholdMs = 2 * 60 * 1000;
  const reloadCooldownMs = 5 * 60 * 1000;
  let pageActive = true;
  let interval = 0;
  let lastProgressSignature = '';
  let stalledSince = 0;

  const readLastReloadAt = () => {
    try { return Number(sessionStorage.getItem(reloadKey) || 0); } catch (_) { return 0; }
  };
  const writeLastReloadAt = now => {
    try { sessionStorage.setItem(reloadKey, String(now)); } catch (_) {}
  };
  const clearLastReloadAt = () => {
    try { sessionStorage.removeItem(reloadKey); } catch (_) {}
  };
  const activeMediaSignature = () => {
    const values = [];
    for (const element of document.querySelectorAll('audio,video')) {
      if (!element?.isConnected || element.paused || element.ended ||
          element.readyState < 2) {
        continue;
      }
      const currentTime = Number(element.currentTime);
      if (!Number.isFinite(currentTime)) continue;
      const source = String(element.currentSrc || element.src || '');
      // Quarter-second quantization ignores tiny clock jitter while every
      // normal playing element still changes signature well within one sample.
      values.push(`${source}|${Math.floor(currentTime * 4)}`);
    }
    values.sort();
    return values.join('\n');
  };
  const check = () => {
    if (!pageActive) return;
    const signature = activeMediaSignature();
    if (!signature) {
      lastProgressSignature = '';
      stalledSince = 0;
      return;
    }

    const now = Date.now();
    if (signature !== lastProgressSignature) {
      lastProgressSignature = signature;
      stalledSince = 0;
      clearLastReloadAt();
      return;
    }
    if (!stalledSince) {
      stalledSince = now;
      return;
    }
    if (now - stalledSince < stallThresholdMs) return;

    const lastReloadAt = readLastReloadAt();
    if (lastReloadAt > 0 && now - lastReloadAt < reloadCooldownMs) {
      stalledSince = now;
      return;
    }
    writeLastReloadAt(now);
    pageActive = false;
    if (interval) {
      nativeClearInterval(interval);
      interval = 0;
    }
    location.reload();
  };
  const stop = () => {
    pageActive = false;
    stalledSince = 0;
    if (interval) {
      nativeClearInterval(interval);
      interval = 0;
    }
  };

  window.addEventListener('pagehide', stop, true);
  interval = nativeSetInterval(check, sampleIntervalMs);
  check();
})()
)JS";
  return kScript;
}

inline std::wstring StationheadAutoplayScriptWithMediaProgressWatchdog(
    const wchar_t* globalName,
    const wchar_t* messagePrefix) {
  std::wstring script = StationheadAutoplayScript(globalName, messagePrefix);
  script.push_back(L'\n');
  script.append(StationheadMediaProgressWatchdogScript());
  return script;
}

}  // namespace hp

// sh_polling_policy.h has already defined the canonical autoplay wrapper above.
// Rewrite subsequent call sites only, so sh_webview.cpp injects the additional
// watchdog without duplicating or replacing the existing Start Listening,
// blank-page recovery, and audio-only UI policies.
#define StationheadAutoplayScript StationheadAutoplayScriptWithMediaProgressWatchdog
