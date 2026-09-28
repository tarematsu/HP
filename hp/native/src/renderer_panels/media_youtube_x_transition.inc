LR"JS(
(() => {
  if (!/^(?:www\.)?youtube\.com$/.test(location.hostname)) return false;

  const state = window.__homePanelYoutubeXRuntime ||
      (window.__homePanelYoutubeXRuntime = {});
  const storageKey = 'homepanel:youtube-x-phase-start:v1';
  const phaseMs = 60 * 60 * 1000;
  const staleMs = 62 * 60 * 1000;
  const now = Date.now();
  let startedAt = 0;
  try { startedAt = Number(localStorage.getItem(storageKey) || 0); }
  catch (_) {}
  if (!Number.isFinite(startedAt) || startedAt <= 0 || startedAt > now ||
      now - startedAt >= staleMs) {
    startedAt = now;
    try { localStorage.setItem(storageKey, String(startedAt)); }
    catch (_) {}
  }

  const openX = () => {
    try { localStorage.removeItem(storageKey); } catch (_) {}
    location.assign('https://x.com/home');
  };
  clearTimeout(state.xPhaseTimer);
  const remaining = phaseMs - Math.max(0, now - startedAt);
  if (remaining <= 0) openX();
  else state.xPhaseTimer = setTimeout(openX, remaining);
  return true;
})()
;
)JS"