#pragma once

namespace hp {

// Locate genuine playback controls plus the two explicitly allowed onboarding
// actions. CONNECT SPOTIFY and Continue are intentionally handled before the
// generic account/auth guard so they can be clicked even while Stationhead is
// in the background. Other login/account controls remain excluded.
inline std::wstring StationheadLocateStartButtonScriptRuntimeFixed() {
  static constexpr wchar_t kScript[] = LR"JS(
(() => {
  const host = String(location.hostname || '').toLowerCase();
  if ((host !== 'stationhead.com' && !host.endsWith('.stationhead.com')) ||
      window.top !== window) return null;
  const startPattern = /\b(start|join|resume|continue)\s+(listening|station|show|room)\b|\blisten\s+(now|live)\b|^(continue|let(?:'|’)?s\s+go|続ける|続行|次へ)$/i;
  const allowedOnboardingPattern = /^(connect(?:\s+with)?\s+spotify|continue)$/i;
  const accountPattern = /\b(log\s*in|sign\s*in|login|spotify|connect|authorize|consent|account|password|email)\b|ログイン|サインイン|認証|接続|同意|アカウント|パスワード/i;
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
  const visible = element => {
    if (!(element instanceof HTMLElement) || !element.isConnected || element.disabled ||
        element.getAttribute('aria-disabled') === 'true' ||
        element.getAttribute('aria-hidden') === 'true') return false;
    const rect = element.getBoundingClientRect();
    if (!rect || rect.width <= 2 || rect.height <= 2 || rect.right <= 0 ||
        rect.bottom <= 0 || rect.left >= innerWidth || rect.top >= innerHeight) {
      return false;
    }
    const style = getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden' &&
      Number(style.opacity || 1) > 0 && style.pointerEvents !== 'none';
  };
  const pointOf = element => {
    if (!visible(element)) return null;
    const rect = element.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return null;
    const hit = document.elementFromPoint(x, y);
    if (!hit || (hit !== element && !element.contains(hit))) return null;
    return { x, y };
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
  if (!document.body) return null;

  // Explicitly allow only these two onboarding controls through the account
  // guard. Native code dispatches the click through CDP, so no foreground HWND
  // or real mouse cursor is required.
  for (const element of document.querySelectorAll(selector)) {
    if (!labelsOf(element).some(label => allowedOnboardingPattern.test(label))) continue;
    const point = pointOf(element);
    if (point) return point;
  }

  if (playing() || accountInteractionVisible()) return null;

  for (const element of document.querySelectorAll(selector)) {
    if (!visible(element) || !startPattern.test(labelOf(element))) continue;
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
