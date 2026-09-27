LR"JS(
;
(() => {
  if (!/^(?:www\.)?x\.com$/.test(location.hostname)) return false;

  const state = window.__homePanelXLikeRuntime ||
      (window.__homePanelXLikeRuntime = {});
  if (state.started) return true;
  state.started = true;

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const post = message => {
    try { window.chrome?.webview?.postMessage(message); }
    catch (_) {}
  };
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

  const run = async () => {
    try {
      if (document.readyState === 'loading') {
        await new Promise(resolve => document.addEventListener(
            'DOMContentLoaded', resolve, { once: true }));
      }

      // Login is intentionally user-owned. Until X exposes the authenticated
      // Following tab, only observe the DOM: no clicks, scrolling or likes.
      // The native phase clock is held by the waiting-login message below.
      let tab = followingTab();
      while (!tab) {
        state.result = 'waiting-login';
        post('homepanel:x-waiting-login');
        await sleep(1000);
        tab = followingTab();
      }
      state.result = 'authenticated';
      post('homepanel:x-authenticated');

      if (tab.getAttribute('aria-selected') !== 'true') {
        tab.click();
        await sleep(1600);
      }

      window.scrollTo(0, 0);
      await sleep(900);

      const target = 5 + Math.floor(Math.random() * 6);
      const seen = new Set();
      let liked = 0;

      for (let pass = 0; pass < 18 && liked < target; pass++) {
        const articles = Array.from(
            document.querySelectorAll('article[data-testid="tweet"]'));
        for (const article of articles) {
          if (liked >= target) break;
          const key = tweetKey(article);
          if (!key || seen.has(key)) continue;
          seen.add(key);
          if (promoted(article)) continue;

          const button = article.querySelector('[data-testid="like"]');
          if (!visible(button)) continue;
          button.click();
          liked++;
          await sleep(320 + Math.floor(Math.random() * 480));
        }
        if (liked >= target) break;
        window.scrollBy(0, Math.max(360, Math.floor(innerHeight * 0.85)));
        await sleep(850);
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
