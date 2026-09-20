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
  const connectMusicHeadingPattern =
    /^(?:re)?connect(?:\s+(?:to|with|your))?\s+(?:music|spotify(?:\s+account)?)$/i;
  const connectMusicActionPattern =
    /^(?:(?:re)?connect(?:\s+(?:to|with|your))?\s+spotify(?:\s+account)?|(?:re)?connect|spotify)$/i;
  const joinPartyHeadingPattern = /^join\s+the\s+party[!！]?$/i;
  const connectSpotifyTextPattern = /^(?:re)?connect\s+spotify$/i;
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

  const joinPartyConnectSpotifyVisible = () => {
    const candidates = document.querySelectorAll(
      "button,[role='button'],a,div,span,p,[tabindex],[aria-label],[data-testid]");
    for (const candidate of candidates) {
      if (!onboardingRendered(candidate) ||
          !onboardingLabelsOf(candidate).some(
            label => connectSpotifyTextPattern.test(label))) continue;
      for (let shell = candidate.parentElement, depth = 0;
           shell && shell !== document.body && depth < 10;
           shell = shell.parentElement, depth += 1) {
        if (!onboardingRendered(shell)) continue;
        const headings = shell.querySelectorAll(
          'h1,h2,h3,[role="heading"],div,span,p');
        if ([...headings].some(element =>
            onboardingRendered(element) &&
            onboardingLabelsOf(element).some(
              label => joinPartyHeadingPattern.test(label)))) {
          return true;
        }
      }
    }
    return false;
  };

  const recoverableOnboardingVisible = () => {
    // Current Stationhead UI can render a non-semantic CONNECT SPOTIFY control
    // under a "Join the party!" dialog. Detect the exact visible text even when
    // the control is a div/span rather than a native button. The native locator
    // performs the actual trusted CDP click and can scroll it into view.
    if (joinPartyConnectSpotifyVisible()) return true;

    for (const element of document.querySelectorAll(controlSelector)) {
      if (!visible(element)) continue;
      if (onboardingLabelsOf(element).some(
          label => recoverableOnboardingPattern.test(label))) {
        return true;
      }
    }

    // Stationhead has used both Connect Music and Connect Spotify as modal
    // headings, with the clickable action rendered separately as Connect,
    // Reconnect, or Spotify. Treat those exact split surfaces as the same
    // recoverable onboarding flow without broadening the global account guard.
    for (const heading of document.querySelectorAll('h1,h2,h3,[role="heading"]')) {
      if (!visible(heading) ||
          !onboardingLabelsOf(heading).some(
            label => connectMusicHeadingPattern.test(label))) {
        continue;
      }
      for (let surface = heading.parentElement, depth = 0;
           surface && depth < 9;
           surface = surface.parentElement, depth += 1) {
        if (!visible(surface)) continue;
        const action = [...surface.querySelectorAll(controlSelector)]
          .find(element => visible(element) &&
            onboardingLabelsOf(element).some(
              label => connectMusicActionPattern.test(label)));
        if (action) return true;
      }
    }
    return false;
  };

  const publishRecoverableOnboarding = () => {
    if (!pageActive || !document.body) return false;
    const authenticated = accountVisible() || playing();
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
