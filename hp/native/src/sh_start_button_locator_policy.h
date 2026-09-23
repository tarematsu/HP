#pragma once

namespace hp {

// Locate genuine playback controls plus explicitly allowed onboarding/recovery
// actions. The visible label is the stable contract; Stationhead is free to
// render that label as a semantic button, link, styled div/span, or nested text.
// Native code resolves the nearest clickable ancestor and performs a trusted
// CDP click without requiring a foreground HWND.
inline std::wstring StationheadLocateStartButtonScriptRuntimeFixed() {
  std::wstring script;
  script.reserve(12'000);
  script.append(LR"JS(
(() => {
  const host = String(location.hostname || '').toLowerCase();
  if ((host !== 'stationhead.com' && !host.endsWith('.stationhead.com')) ||
      window.top !== window) return null;

  const startPattern =
    /^(?:(?:start|join|resume|continue)\s+(?:listening|station|show|room)|listen\s+(?:now|live)|continue|let(?:'|’)?s\s+go|続ける|続行|次へ)$/i;
  const allowedOnboardingPattern =
    /^(?:(?:re)?connect(?:\s+(?:to|with|your))?\s+(?:spotify(?:\s+account)?|music)|continue(?:\s+with\s+spotify)?|let(?:'|’)?s\s+go)$/i;
  const connectSurfaceLabelPattern =
    /^(?:re)?connect(?:\s+(?:to|with|your))?\s+(?:music|spotify(?:\s+account)?)$/i;
  const connectSurfaceActionPattern =
    /^(?:(?:re)?connect(?:\s+(?:to|with|your))?\s+spotify(?:\s+account)?|(?:re)?connect|spotify)$/i;
  const accountPattern =
    /\b(log\s*in|sign\s*in|login|spotify|connect|reconnect|authorize|consent|account|password|email)\b|ログイン|サインイン|認証|接続|再接続|同意|アカウント|パスワード/i;
  const credentialSelector =
    "input[type='password'],input[type='email'],input[autocomplete='username'],input[autocomplete='current-password']";
  const semanticSelector =
    "button,[role='button'],a,input[type='button'],input[type='submit'],[aria-label],[data-testid],[tabindex]";
  const candidateSelector =
    semanticSelector + ",h1,h2,h3,[role='heading'],div,span,p";
  const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
  const labelsOf = element => [
    element?.getAttribute?.('aria-label'),
    element?.getAttribute?.('data-testid'),
    element?.getAttribute?.('title'),
    element?.getAttribute?.('alt'),
    element?.getAttribute?.('value'),
    element?.innerText,
    element?.textContent,
  ].map(normalize).filter(Boolean);
  const matchesLabel = (element, pattern) =>
    labelsOf(element).some(label => pattern.test(label));

  const visuallyRendered = element => {
    if (!(element instanceof HTMLElement) || !element.isConnected ||
        element.getAttribute('aria-hidden') === 'true') return false;
    const rect = element.getBoundingClientRect();
    if (!rect || rect.width <= 2 || rect.height <= 2) return false;
    const style = getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden' &&
      Number(style.opacity || 1) > 0;
  };
  const rendered = element => {
    if (!visuallyRendered(element) || element.disabled ||
        element.getAttribute('aria-disabled') === 'true') return false;
    return getComputedStyle(element).pointerEvents !== 'none';
  };
  const intersectsViewport = rect =>
    rect && rect.right > 0 && rect.bottom > 0 &&
    rect.left < innerWidth && rect.top < innerHeight;

  const clickableTargetFor = element => {
    for (let current = element, depth = 0;
         current && current !== document.body && depth < 12;
         current = current.parentElement, depth += 1) {
      if (!rendered(current)) continue;
      const tag = String(current.tagName || '').toLowerCase();
      const role = String(current.getAttribute?.('role') || '').toLowerCase();
      const tabindex = current.getAttribute?.('tabindex');
      const style = getComputedStyle(current);
      if (tag === 'button' || tag === 'a' || tag === 'input' ||
          role === 'button' || tabindex !== null ||
          typeof current.onclick === 'function' || style.cursor === 'pointer') {
        return current;
      }
    }
    return null;
  };
)JS");

  script.append(LR"JS(
  const pointOf = element => {
    if (!element || !rendered(element)) return null;
    let rect = element.getBoundingClientRect();
    let x = rect.left + rect.width / 2;
    let y = rect.top + rect.height / 2;
    if (!intersectsViewport(rect) || x < 0 || y < 0 ||
        x >= innerWidth || y >= innerHeight) {
      try {
        element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'auto' });
      } catch (_) {
        try { element.scrollIntoView(); } catch (_) {}
      }
      rect = element.getBoundingClientRect();
      x = rect.left + rect.width / 2;
      y = rect.top + rect.height / 2;
    }
    if (!intersectsViewport(rect) || x < 0 || y < 0 ||
        x >= innerWidth || y >= innerHeight) return null;
    const hit = document.elementFromPoint(x, y);
    if (!hit || (hit !== element && !element.contains(hit))) return null;
    return { x, y };
  };

  const actionablePointForPattern = pattern => {
    for (const element of document.querySelectorAll(candidateSelector)) {
      if (!visuallyRendered(element) || !matchesLabel(element, pattern)) continue;
      const point = pointOf(clickableTargetFor(element));
      if (point) return point;
    }
    return null;
  };

  const plainPointForPattern = pattern => {
    for (const element of document.querySelectorAll(candidateSelector)) {
      if (!rendered(element) || !matchesLabel(element, pattern)) continue;
      const point = pointOf(element);
      if (point) return point;
    }
    return null;
  };

  const splitConnectSurfacePoint = () => {
    let plainFallback = null;
    for (const anchor of document.querySelectorAll(candidateSelector)) {
      if (!visuallyRendered(anchor) ||
          !matchesLabel(anchor, connectSurfaceLabelPattern)) continue;
      for (let surface = anchor.parentElement, depth = 0;
           surface && surface !== document.body && depth < 10;
           surface = surface.parentElement, depth += 1) {
        if (!visuallyRendered(surface)) continue;
        for (const action of surface.querySelectorAll(candidateSelector)) {
          if (!visuallyRendered(action) ||
              !matchesLabel(action, connectSurfaceActionPattern)) continue;
          const actionable = pointOf(clickableTargetFor(action));
          if (actionable) return actionable;
          if (!plainFallback && rendered(action)) {
            plainFallback = pointOf(action);
          }
        }
      }
    }
    return plainFallback;
  };

  const playing = () => {
    if (typeof window.__homepanelAudioPlaying === 'boolean') {
      return window.__homepanelAudioPlaying;
    }
    if (navigator.mediaSession?.playbackState === 'playing') return true;
    return Array.from(document.querySelectorAll('audio,video')).some(element =>
      !element.paused && !element.ended && element.readyState >= 2);
  };
)JS");

  script.append(LR"JS(
  const accountInteractionVisible = () => {
    if (window.__homepanelStationheadBlockingLoginVisible === true ||
        /(^|\/)(login|signin|sign-in|auth)(\/|$)/i.test(
          String(location.pathname || ''))) {
      return true;
    }
    for (const element of document.querySelectorAll(credentialSelector)) {
      if (visuallyRendered(element) &&
          intersectsViewport(element.getBoundingClientRect())) {
        return true;
      }
    }
    for (const element of document.querySelectorAll(semanticSelector)) {
      if (!visuallyRendered(element) || !matchesLabel(element, accountPattern)) continue;
      if (element.closest?.(
          "form,[role='dialog'],[aria-modal='true'],[data-testid*='auth' i],[data-testid*='login' i],[id*='auth' i],[id*='login' i]")) {
        return true;
      }
    }
    return false;
  };

  if (!document.body) return null;

  // Prefer genuine actionable controls before any text-only fallback. In the
  // split `Reconnect Music` layout the heading and the Reconnect button are
  // siblings; clicking the heading first would consume every retry without
  // ever reaching the real action.
  const actionableOnboardingPoint =
      actionablePointForPattern(allowedOnboardingPattern);
  if (actionableOnboardingPoint) return actionableOnboardingPoint;
  const splitConnectPoint = splitConnectSurfacePoint();
  if (splitConnectPoint) return splitConnectPoint;
  const plainOnboardingPoint = plainPointForPattern(allowedOnboardingPattern);
  if (plainOnboardingPoint) return plainOnboardingPoint;

  // Playback-start actions remain blocked by genuine login/account UI and by an
  // already-playing document, but their DOM semantics are intentionally ignored.
  if (playing() || accountInteractionVisible()) return null;
  let plainStartFallback = null;
  for (const element of document.querySelectorAll(candidateSelector)) {
    if (!visuallyRendered(element) || !matchesLabel(element, startPattern)) continue;
    if (element.matches?.('audio,video') || element.querySelector?.('audio,video')) continue;
    const target = clickableTargetFor(element);
    if (!target) {
      if (!plainStartFallback && rendered(element)) {
        plainStartFallback = pointOf(element);
      }
      continue;
    }
    const href = String(
      target.getAttribute?.('href') || element.getAttribute?.('href') || '').toLowerCase();
    if (/(^|\/)(login|signin|sign-in|auth|account|settings)(\/|$)|spotify|authorize|consent/.test(href)) {
      continue;
    }
    const shell = target.closest?.("form,[role='dialog'],[aria-modal='true']");
    if (shell && (shell.querySelector?.(credentialSelector) ||
        accountPattern.test(normalize(shell.innerText || shell.textContent || '')))) {
      continue;
    }
    const point = pointOf(target);
    if (point) return point;
  }
  return plainStartFallback;
})()
)JS");
  return script;
}

}  // namespace hp

#undef StationheadLocateStartButtonScript
#define StationheadLocateStartButtonScript StationheadLocateStartButtonScriptRuntimeFixed
