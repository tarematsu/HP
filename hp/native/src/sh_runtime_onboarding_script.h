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
  const onboardingLabelsOf = element => [
    element?.getAttribute?.('aria-label'),
    element?.getAttribute?.('data-testid'),
    element?.getAttribute?.('title'),
    element?.getAttribute?.('alt'),
    element?.getAttribute?.('value'),
    element?.innerText,
    element?.textContent,
  ].map(normalize).filter(Boolean);

  const recoverableOnboardingVisible = () => {
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
