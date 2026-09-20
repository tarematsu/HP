#pragma once

namespace hp {

// Locate genuine playback controls plus explicitly allowed onboarding/recovery
// actions. Connect/Reconnect Music or Spotify, Continue, Continue with Spotify,
// and Let's GO are intentionally handled before the generic account/auth guard
// so they can be clicked even while Stationhead is in the background. Other
// login/account controls remain excluded.
inline std::wstring StationheadLocateStartButtonScriptRuntimeFixed() {
  static constexpr wchar_t kScript[] = LR"JS(
(() => {
  const host = String(location.hostname || '').toLowerCase();
  if ((host !== 'stationhead.com' && !host.endsWith('.stationhead.com')) ||
      window.top !== window) return null;
  const startPattern = /\b(start|join|resume|continue)\s+(listening|station|show|room)\b|\blisten\s+(now|live)\b|^(continue|let(?:'|’)?s\s+go|続ける|続行|次へ)$/i;
  const allowedOnboardingPattern = /^(?:(?:re)?connect(?:\s+(?:to|with|your))?\s+(?:spotify(?:\s+account)?|music)|continue(?:\s+with\s+spotify)?|let(?:'|’)?s\s+go)$/i;
  const connectMusicHeadingPattern = /^(?:re)?connect(?:\s+(?:to|with|your))?\s+(?:music|spotify(?:\s+account)?)$/i;
  const connectMusicActionPattern = /^(?:(?:re)?connect(?:\s+(?:to|with|your))?\s+spotify(?:\s+account)?|(?:re)?connect|spotify)$/i;
  const joinPartyHeadingPattern = /^join\s+the\s+party[!！]?$/i;
  const connectSpotifyTextPattern = /^(?:re)?connect\s+spotify$/i;
  const accountPattern = /\b(log\s*in|sign\s*in|login|spotify|connect|reconnect|authorize|consent|account|password|email)\b|ログイン|サインイン|認証|接続|再接続|同意|アカウント|パスワード/i;
  const credentialSelector = "input[type='password'],input[type='email'],input[autocomplete='username'],input[autocomplete='current-password']";
  const selector = "button,[role='button'],a,input[type='button'],input[type='submit'],[aria-label],[data-testid],[tabindex]";
  const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
  const labelsOf = element => [
    element?.innerText,
    element?.getAttribute?.('aria-label'),
    element?.textContent,
    element?.getAttribute?.('title'),
    element?.getAttribute?.('value'),
    element?.getAttribute?.('data-testid'),
  ].map(normalize).filter(Boolean);
  const labelOf = element => normalize(labelsOf(element).join(' '));
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
  const visible = element =>
    rendered(element) && intersectsViewport(element.getBoundingClientRect());
  const pointOf = element => {
    if (!rendered(element)) return null;
    let rect = element.getBoundingClientRect();
    let x = rect.left + rect.width / 2;
    let y = rect.top + rect.height / 2;
    if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) {
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
  const clickableTargetFor = element => {
    for (let current = element, depth = 0;
         current && current !== document.body && depth < 7;
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
    return rendered(element) ? element : null;
  };
  const playing = () => {
    if (typeof window.__homepanelAudioPlaying === 'boolean') {
      return window.__homepanelAudioPlaying;
    }
    if (navigator.mediaSession?.playbackState === 'playing') return true;
    return Array.from(document.querySelectorAll('audio,video')).some(element =>
      !element.paused && !element.ended && element.readyState >= 2);
  };
  const accountInteractionVisible = () => {
    if (window.__homepanelStationheadBlockingLoginVisible === true ||
        /(^|\/)(login|signin|sign-in|auth)(\/|$)/i.test(
          String(location.pathname || ''))) {
      return true;
    }
    for (const element of document.querySelectorAll(credentialSelector)) {
      if (visible(element)) return true;
    }
    for (const element of document.querySelectorAll(selector)) {
      if (!visible(element) || !accountPattern.test(labelOf(element))) continue;
      if (element.closest?.("form,[role='dialog'],[aria-modal='true'],[data-testid*='auth' i],[data-testid*='login' i],[id*='auth' i],[id*='login' i]")) {
        return true;
      }
    }
    return false;
  };
  const findConnectMusicHeading = () => {
    const headingSelector = "h1,h2,h3,[role='heading']";
    for (const heading of document.querySelectorAll(headingSelector)) {
      if (visuallyRendered(heading) &&
          labelsOf(heading).some(label => connectMusicHeadingPattern.test(label))) {
        return heading;
      }
    }
    return null;
  };
  const findConnectMusicText = () => {
    for (const element of document.querySelectorAll('*')) {
      if (!visuallyRendered(element) ||
          !labelsOf(element).some(label => connectMusicHeadingPattern.test(label))) continue;
      return element;
    }
    return null;
  };
  const connectMusicModalAction = () => {
    const anchor = findConnectMusicHeading() || findConnectMusicText();
    if (!anchor) return null;
    const dialog = anchor.closest?.("[role='dialog'],[aria-modal='true']");
    const shells = [];
    if (dialog) shells.push(dialog);
    for (let shell = anchor.parentElement, depth = 0;
         shell && shell !== document.body && depth < 10;
         depth += 1, shell = shell.parentElement) {
      if (!shells.includes(shell)) shells.push(shell);
    }
    for (const shell of shells) {
      for (const action of shell.querySelectorAll(selector)) {
        if (!labelsOf(action).some(label => connectMusicActionPattern.test(label))) continue;
        const point = pointOf(action);
        if (point) return point;
      }
    }
    return null;
  };
  const joinPartyConnectSpotifyPoint = () => {
    const candidates = document.querySelectorAll(
      "button,[role='button'],a,div,span,p,[tabindex],[aria-label],[data-testid]");
    for (const candidate of candidates) {
      if (!visuallyRendered(candidate) ||
          !labelsOf(candidate).some(label => connectSpotifyTextPattern.test(label))) {
        continue;
      }
      let matchingShell = null;
      for (let shell = candidate.parentElement, depth = 0;
           shell && shell !== document.body && depth < 10;
           shell = shell.parentElement, depth += 1) {
        if (!visuallyRendered(shell)) continue;
        const headings = shell.querySelectorAll(
          'h1,h2,h3,[role="heading"],div,span,p');
        if ([...headings].some(element =>
            visuallyRendered(element) &&
            labelsOf(element).some(label => joinPartyHeadingPattern.test(label)))) {
          matchingShell = shell;
          break;
        }
      }
      if (!matchingShell) continue;
      const target = clickableTargetFor(candidate);
      const point = pointOf(target);
      if (point) return point;
    }
    return null;
  };
  if (!document.body) return null;

  // Current Stationhead UI may render CONNECT SPOTIFY as a styled div/span in
  // a "Join the party!" dialog. Handle that exact dialog before semantic-button
  // matching so the click does not depend on the DOM role used by Stationhead.
  const joinPartyPoint = joinPartyConnectSpotifyPoint();
  if (joinPartyPoint) return joinPartyPoint;

  const modalConnectPoint = connectMusicModalAction();
  if (modalConnectPoint) return modalConnectPoint;

  for (const element of document.querySelectorAll(selector)) {
    if (!labelsOf(element).some(label => allowedOnboardingPattern.test(label))) continue;
    const point = pointOf(element);
    if (point) return point;
  }

  if (playing() || accountInteractionVisible()) return null;

  for (const element of document.querySelectorAll(selector)) {
    if (!rendered(element) || !startPattern.test(labelOf(element))) continue;
    if (element.matches('audio,video') || element.querySelector?.('audio,video')) continue;
    const href = String(element.getAttribute?.('href') || '').toLowerCase();
    if (/(^|\/)(login|signin|sign-in|auth|account|settings)(\/|$)|spotify|authorize|consent/.test(href)) {
      continue;
    }
    const shell = element.closest?.("form,[role='dialog'],[aria-modal='true']");
    if (shell && (shell.querySelector?.(credentialSelector) || accountPattern.test(labelOf(shell)))) {
      continue;
    }
    const point = pointOf(element);
    if (point) return point;
  }
  return null;
})()
)JS";
  return kScript;
}

}  // namespace hp

#undef StationheadLocateStartButtonScript
#define StationheadLocateStartButtonScript StationheadLocateStartButtonScriptRuntimeFixed
