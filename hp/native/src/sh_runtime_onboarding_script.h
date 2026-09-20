#pragma once

namespace hp {

// Recoverable Stationhead music-service onboarding. This is appended inside the
// same compact-runtime IIFE after the base interaction helpers are declared.
// It deliberately reuses visible/account/blocking helpers from that owner and
// only publishes signals for the explicit native trusted-click allowlist.
inline std::wstring_view StationheadRuntimeOnboardingFragment() noexcept {
  static constexpr std::wstring_view kFragment = LR"JS(
  const recoverableOnboardingPattern =
    /^(?:(?:re)?connect(?:\s+(?:to|with|your))?\s+(?:spotify(?:\s+account)?|music)|continue(?:\s+with\s+spotify)?|let(?:'|’)?s\s+go)$/i;
  const connectSurfaceLabelPattern =
    /^(?:re)?connect(?:\s+(?:to|with|your))?\s+(?:music|spotify(?:\s+account)?)$/i;
  const connectSurfaceActionPattern =
    /^(?:(?:re)?connect(?:\s+(?:to|with|your))?\s+spotify(?:\s+account)?|(?:re)?connect|spotify)$/i;
  const onboardingCandidateSelector =
    "button,[role='button'],a,input[type='button'],input[type='submit']," +
    "div,span,p,[tabindex],[aria-label],[data-testid]";
  const onboardingLabelsOf = element => [
    element?.getAttribute?.('aria-label'),
    element?.getAttribute?.('data-testid'),
    element?.getAttribute?.('title'),
    element?.getAttribute?.('alt'),
    element?.getAttribute?.('value'),
    element?.innerText,
    element?.textContent,
  ].map(normalize).filter(Boolean);
  const onboardingRendered = element => {
    if (!(element instanceof Element) || !element.isConnected ||
        element.getAttribute('aria-hidden') === 'true') return false;
    const rect = element.getBoundingClientRect?.();
    if (!rect || rect.width <= 2 || rect.height <= 2) return false;
    const style = getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden' &&
      Number(style.opacity || 1) > 0;
  };
  const onboardingMatches = (element, pattern) =>
    onboardingRendered(element) &&
    onboardingLabelsOf(element).some(label => pattern.test(label));

  const splitConnectSurfaceVisible = () => {
    // Stationhead has rendered music-service prompts in several different DOM
    // shapes: semantic buttons, styled div/span controls, and a label with a
    // separate Connect/Reconnect action. Treat the visible text as the stable
    // contract and keep all matching local to the same ancestor surface.
    for (const anchor of document.querySelectorAll(onboardingCandidateSelector)) {
      if (!onboardingMatches(anchor, connectSurfaceLabelPattern)) continue;
      for (let surface = anchor.parentElement, depth = 0;
           surface && surface !== document.body && depth < 10;
           surface = surface.parentElement, depth += 1) {
        if (!onboardingRendered(surface)) continue;
        for (const action of surface.querySelectorAll(onboardingCandidateSelector)) {
          if (onboardingMatches(action, connectSurfaceActionPattern)) return true;
        }
      }
    }
    return false;
  };

  const recoverableOnboardingVisible = () => {
    // Do not depend on element semantics. A visually button-like Stationhead
    // control may be a div/span. Exact allowlisted labels keep this broad DOM
    // search from turning account/login controls into automatic clicks.
    for (const element of document.querySelectorAll(onboardingCandidateSelector)) {
      if (onboardingMatches(element, recoverableOnboardingPattern)) return true;
    }
    return splitConnectSurfaceVisible();
  };

  const publishRecoverableOnboarding = () => {
    // Connect/Reconnect-style recovery is not a normal foreground action.
    // Arm it only after this document has positively played once and native
    // playback state has subsequently gone false. Start Listening keeps its
    // separate startup path and is not gated by this recovery condition.
    if (!pageActive || !document.body || !playbackEstablished || playing()) {
      return false;
    }
    const authenticated = accountVisible();
    // A genuine login form/route always wins. Only the explicit allowlisted
    // music-service recovery surface is permitted to clear a stale login latch.
    if (blockingLogin(authenticated) || !recoverableOnboardingVisible()) {
      return false;
    }
    cancelAuthReady();
    lastBlocking = false;
    window.__homepanelStationheadBlockingLoginVisible = false;
    post({ type: 'stationhead-auth-ready', source: 'recoverable-onboarding' });
    postText('start-visible');
    return true;
  };
)JS";
  return kFragment;
}

}  // namespace hp
