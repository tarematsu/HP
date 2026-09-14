#pragma once

namespace hp {

// Bounded semantic pruning for production Stationhead DOM that lacks stable
// test ids. This policy owns only presentation removal. It deliberately avoids
// persistent observers/timers and protects login/start/Spotify controls before
// hiding an ancestor container.
inline std::wstring StationheadMinimalUiPruningScript() {
  static constexpr wchar_t kScript[] = LR"JS(
(() => {
  const host = String(location.hostname || '').toLowerCase();
  if (host !== 'stationhead.com' && !host.endsWith('.stationhead.com')) return;
  const pruneClass = '__homepanelStationheadPruned';
  if (window.__homepanelStationheadMinimalUiScheduled) return true;
  window.__homepanelStationheadMinimalUiScheduled = true;

  const normalize = value => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const controlSelector = "button,[role='button'],a,input[type='button'],input[type='submit']";
  const protectedControlText = text =>
      text.includes('start listening') ||
      text === 'log in' || text === 'login' || text === 'sign in' ||
      text.includes('connect spotify') || text.includes('continue with spotify');
  const hasProtectedControl = root => {
    if (!root?.querySelectorAll) return false;
    for (const control of root.querySelectorAll(controlSelector)) {
      const text = normalize(control.textContent || control.getAttribute('aria-label') || control.value);
      if (protectedControlText(text)) return true;
    }
    return false;
  };
  const hide = element => {
    if (!element?.classList || hasProtectedControl(element)) return false;
    element.classList.add(pruneClass);
    return true;
  };
  const compactAncestor = (element, widthRatio, heightRatio) => {
    let node = element;
    let candidate = element;
    for (let depth = 0; depth < 5 && node?.parentElement; depth += 1) {
      node = node.parentElement;
      if (node === document.body || node === document.documentElement || hasProtectedControl(node)) break;
      const rect = node.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0 &&
          rect.width <= innerWidth * widthRatio && rect.height <= innerHeight * heightRatio) {
        candidate = node;
      }
    }
    return candidate;
  };

  const pruneActionRows = () => {
    const actionLabels = [
      'threads', 'following', 'request song', 'ask to speak',
      'share', 'get the app', 'all access'
    ];
    for (const control of document.querySelectorAll(controlSelector)) {
      const text = normalize(control.textContent || control.getAttribute('aria-label') || control.value);
      if (!text || protectedControlText(text)) continue;
      if (actionLabels.some(label => text === label || text.startsWith(label + ' '))) {
        hide(compactAncestor(control, 0.72, 0.16));
      }
    }
  };

  const pruneChatRail = () => {
    for (const input of document.querySelectorAll("input,textarea,[contenteditable='true']")) {
      const placeholder = normalize(input.getAttribute('placeholder'));
      if (!placeholder.includes('send a message')) continue;
      let node = input;
      let candidate = null;
      for (let depth = 0; depth < 9 && node?.parentElement; depth += 1) {
        node = node.parentElement;
        if (node === document.body || node === document.documentElement || hasProtectedControl(node)) break;
        const rect = node.getBoundingClientRect();
        if (rect.width >= innerWidth * 0.20 && rect.width <= innerWidth * 0.60 &&
            rect.height >= innerHeight * 0.32 && rect.right >= innerWidth * 0.70) {
          candidate = node;
        }
      }
      if (candidate) hide(candidate);
    }
  };

  const pruneMiniPlayer = () => {
    for (const element of document.querySelectorAll('span,p,small')) {
      const text = normalize(element.textContent);
      if (!text.includes("i'm on stationhead")) continue;
      let node = element;
      let candidate = null;
      for (let depth = 0; depth < 7 && node?.parentElement; depth += 1) {
        node = node.parentElement;
        if (node === document.body || node === document.documentElement || hasProtectedControl(node)) break;
        const rect = node.getBoundingClientRect();
        if (rect.width >= innerWidth * 0.55 && rect.height <= innerHeight * 0.25 &&
            rect.bottom >= innerHeight * 0.65) {
          candidate = node;
        }
      }
      if (candidate) hide(candidate);
    }
  };

  const pruneBadgesAndChrome = () => {
    for (const element of document.querySelectorAll('span,p,small')) {
      const text = normalize(element.textContent);
      if (text === 'on air' || text.startsWith('syndicating on ')) {
        hide(compactAncestor(element, 0.55, 0.18));
      }
    }
    for (const element of document.querySelectorAll('header,footer')) hide(element);
  };

  const prune = () => {
    if (!document.body) return;
    pruneActionRows();
    pruneChatRail();
    pruneMiniPlayer();
    pruneBadgesAndChrome();
  };

  const schedule = () => {
    for (const delay of [0, 500, 1500, 4000, 8000, 15000]) {
      setTimeout(prune, delay);
    }
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', schedule, { once: true });
  } else {
    schedule();
  }
  return true;
})()
)JS";
  return kScript;
}

}  // namespace hp
