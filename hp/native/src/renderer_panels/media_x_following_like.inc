LR"JS(
;
(() => {
  if (!/^(?:www\.)?x\.com$/.test(location.hostname)) return false;

  const state = window.__homePanelXLikeRuntime ||
      (window.__homePanelXLikeRuntime = {});
  if (state.started) return true;
  state.started = true;

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const text = element => (element?.innerText || element?.textContent || '')
      .replace(/\s+/g, ' ').trim();
  const followingTab = () => Array.from(document.querySelectorAll('[role="tab"]'))
      .find(tab => /^(?:Following|フォロー中)$/i.test(text(tab)));

  const run = async () => {
    try {
      if (document.readyState === 'loading') {
        await new Promise(resolve => document.addEventListener(
            'DOMContentLoaded', resolve, { once: true }));
      }

      let tab = followingTab();
      while (!tab) {
        state.result = 'waiting-login';
        await sleep(1000);
        tab = followingTab();
      }
      state.result = 'authenticated';

      if (tab.getAttribute('aria-selected') !== 'true') {
        tab.click();
        await sleep(1600);
      }

      window.scrollTo(0, 0);
      await sleep(1200);
      for (let pass = 0; pass < 12; pass++) {
        const scrollDistance = Math.max(
            220,
            Math.floor(innerHeight * (0.35 + Math.random() * 0.20)));
        window.scrollBy({ top: scrollDistance, behavior: 'smooth' });
        await sleep(1800 + Math.floor(Math.random() * 1400));
      }
      state.result = 'completed';
    } catch (_) {
      state.result = 'error';
    } finally {
      state.completed = true;
    }
  };

  setTimeout(() => { void run(); }, 700);
  return true;
})()
)JS"
