#pragma once
#include "sh_startup_resource_reduction_policy_fix.h"

namespace hp {

// The first DOM reducer kept only the first mutation root scheduled before each
// animation frame. Later roots could stay mounted and were merely hidden by the
// fallback stylesheet. Queue every added subtree and remove optional surfaces
// from the DOM while preserving playback, Spotify and login controls.
inline std::wstring StationheadStartupDomBatchFixedScript() {
  static constexpr wchar_t kScript[] = LR"JS(
(() => {
  const host = String(location.hostname || '').toLowerCase();
  if ((host !== 'stationhead.com' && !host.endsWith('.stationhead.com')) ||
      window.top !== window || window.__homepanelStationheadStartupDomReduction) {
    return;
  }
  window.__homepanelStationheadStartupDomReduction = true;

  const optionalSelectors = [
    '[data-testid*="gif" i]',
    '[data-testid*="chat" i]',
    '[data-testid*="thread" i]',
    '[data-testid*="tipping" i]',
    '[data-testid*="gift" i]',
    '[data-testid*="reaction" i]',
    '[data-testid*="emoji" i]',
    '[data-testid*="leaderboard" i]',
    '[data-testid*="apple-music" i]',
    '[data-testid*="free-trial" i]',
    '[data-testid*="download-app" i]',
    '[aria-label*="gif" i]',
    '[aria-label*="open chat" i]',
    '[aria-label*="send gift" i]',
    'img[src*="giphy" i]',
    'img[src*="/gif" i]'
  ];
  const selector = optionalSelectors.join(',');
  const hardOptionalImageSelector = 'img[src*="giphy" i],img[src*="/gif" i]';
  const protectedPattern = /start\s+listening|listen\s+(?:now|live)|join\s+(?:station|room)|spotify|log\s*in|sign\s*in|login|play|pause|resume|continue|audio|volume|ログイン|再生|一時停止|続ける|接続/i;
  const optionalLabelPattern = /^(?:gif|open gif|chat|open chat|threads?|tipping|send (?:a )?gift|gifts?|reactions?|emoji|leaderboard|connect apple music|start free trial|download (?:the )?app|get the app)$/i;
  const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
  const labelOf = element => normalize([
    element?.getAttribute?.('aria-label'),
    element?.getAttribute?.('data-testid'),
    element?.getAttribute?.('title'),
    element?.innerText,
    element?.textContent,
  ].filter(Boolean).join(' '));
  const protectedSurface = element => {
    const shell = element?.closest?.(
      'form,[role="dialog"],[aria-modal="true"],[data-testid*="auth" i],[data-testid*="login" i]');
    return protectedPattern.test(labelOf(element)) ||
      (shell && protectedPattern.test(labelOf(shell)));
  };
  const remove = element => {
    if (!(element instanceof Element) || !element.isConnected) return;
    const hardOptionalImage = element.matches(hardOptionalImageSelector);
    if (!hardOptionalImage && protectedSurface(element)) return;
    element.remove();
  };
  const scan = root => {
    if (!root?.querySelectorAll) return;
    if (root instanceof Element && root.matches(selector)) remove(root);
    for (const element of root.querySelectorAll(selector)) remove(element);
    for (const element of root.querySelectorAll(
        'button,[role="button"],a,[aria-label],[title]')) {
      const label = labelOf(element);
      if (optionalLabelPattern.test(label) && !protectedPattern.test(label)) {
        remove(element);
      }
    }
  };

  let active = true;
  let frame = 0;
  const pendingRoots = new Set();
  const normalizeRoot = root =>
    root instanceof Element && root.isConnected ? root : document;
  const flush = () => {
    frame = 0;
    if (!active) {
      pendingRoots.clear();
      return;
    }
    const roots = Array.from(pendingRoots);
    pendingRoots.clear();
    if (!roots.length) roots.push(document);
    for (const root of roots) scan(normalizeRoot(root));
  };
  const schedule = root => {
    if (!active) return;
    pendingRoots.add(normalizeRoot(root));
    if (!frame) frame = requestAnimationFrame(flush);
  };
  const observer = new MutationObserver(records => {
    let addedElement = false;
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (!(node instanceof Element)) continue;
        pendingRoots.add(node);
        addedElement = true;
      }
    }
    if (!addedElement) pendingRoots.add(document);
    if (!frame) frame = requestAnimationFrame(flush);
  });
  const stop = () => {
    if (!active) return;
    active = false;
    observer.disconnect();
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    pendingRoots.clear();
  };
  observer.observe(document, { childList: true, subtree: true });
  window.addEventListener('pagehide', stop, { once: true, capture: true });
  window.setTimeout(stop, 15000);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => schedule(document), { once: true });
  } else {
    schedule(document);
  }
})()
)JS";
  return kScript;
}

inline std::wstring StationheadAutoplayScriptStartupDomBatchFixed(
    const wchar_t* globalName,
    const wchar_t* messagePrefix) {
  std::wstring script =
      StationheadAutoplayScriptRuntimeFixed(globalName, messagePrefix);
  script.push_back(L'\n');
  script.append(StationheadStartupDomBatchFixedScript());
  return script;
}

}  // namespace hp

#undef StationheadAutoplayScript
#define StationheadAutoplayScript StationheadAutoplayScriptStartupDomBatchFixed
