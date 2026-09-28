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
  const visible = element => {
    if (!(element instanceof HTMLElement) || !element.isConnected) return false;
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    const style = getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden' &&
        Number(style.opacity || 1) > 0.05;
  };
  const promoted = article => {
    const value = text(article);
    return /(?:^|\s)(?:Promoted|プロモーション|広告)(?:\s|$)/i.test(value) ||
        Boolean(article.querySelector('[data-testid*="placement" i]'));
  };
  const tweetKey = article => {
    const status = article.querySelector('a[href*="/status/"]');
    return status?.getAttribute('href') || text(article).slice(0, 240);
  };
  const followingTab = () => Array.from(document.querySelectorAll('[role="tab"]'))
      .find(tab => /^(?:Following|フォロー中)$/i.test(text(tab)));

  const startupKey = 'homepanel:startup-x-until:v1';
  const youtubeStart =
      'https://homepanel-cloud.tarematsu.workers.dev/v1/native/youtube-start';
  let startupUntil = 0;
  try { startupUntil = Number(sessionStorage.getItem(startupKey) || 0); }
  catch (_) {}
  const startupRequested =
      new URLSearchParams(location.search).get('homepanel') === 'startup';
  if (startupRequested &&
      (!Number.isFinite(startupUntil) || startupUntil <= Date.now())) {
    startupUntil = Date.now() + 5 * 60 * 1000;
    try { sessionStorage.setItem(startupKey, String(startupUntil)); }
    catch (_) {}
  }
  if (Number.isFinite(startupUntil) && startupUntil > 0) {
    const remaining = startupUntil - Date.now();
    if (remaining > 0) {
      clearTimeout(state.startupExitTimer);
      state.startupExitTimer = setTimeout(() => {
        try { sessionStorage.removeItem(startupKey); } catch (_) {}
        location.assign(youtubeStart);
      }, remaining);
    } else {
      try { sessionStorage.removeItem(startupKey); } catch (_) {}
    }
  }

  const run = async () => {
    try {
      if (document.readyState === 'loading') {
        await new Promise(resolve => document.addEventListener(
            'DOMContentLoaded', resolve, { once: true }));
      }

      // Login is intentionally user-owned. Until X exposes the authenticated
      // Following tab, only observe the DOM: no clicks, scrolling or likes.
      // The native 5-minute X window keeps running while login is pending.
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

      const target = 2 + Math.floor(Math.random() * 4);
      const seen = new Set();
      let liked = 0;

      for (let pass = 0; pass < 24 && liked < target; pass++) {
        const scrollDistance = Math.max(
            220,
            Math.floor(innerHeight * (0.35 + Math.random() * 0.20)));
        window.scrollBy({ top: scrollDistance, behavior: 'smooth' });
        await sleep(1800 + Math.floor(Math.random() * 1400));

        const articles = Array.from(
            document.querySelectorAll('article[data-testid="tweet"]'));
        let likedThisPass = false;
        for (const article of articles) {
          const key = tweetKey(article);
          if (!key || seen.has(key)) continue;
          if (promoted(article)) {
            seen.add(key);
            continue;
          }

          const button = article.querySelector('[data-testid="like"]');
          if (!visible(button)) continue;
          seen.add(key);
          button.click();
          liked++;
          likedThisPass = true;
          await sleep(1400 + Math.floor(Math.random() * 1600));
          break;
        }
        if (!likedThisPass) {
          await sleep(900 + Math.floor(Math.random() * 900));
        }
      }

      state.targetCount = target;
      state.likedCount = liked;
      state.result = liked > 0 ? 'completed' : 'no-unliked-posts';
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
