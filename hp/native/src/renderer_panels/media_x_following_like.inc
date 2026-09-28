LR"JS(
;
(() => {
  if (!/^(?:www\.)?x\.com$/.test(location.hostname)) return false;

  const state = window.__homePanelXLikeRuntime ||
      (window.__homePanelXLikeRuntime = {});
  if (state.started) return true;
  state.started = true;
  const deadline = performance.now() + 60 * 1000;
  const likeIntervalMs = 10 * 1000;

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const text = element => (element?.innerText || element?.textContent || '')
      .replace(/\s+/g, ' ').trim();
  const followingTab = () => Array.from(document.querySelectorAll('[role="tab"]'))
      .find(tab => /^(?:Following|フォロー中)$/i.test(text(tab)));
  const isPromoted = article => {
    const value = text(article);
    return /(?:^|\s)(?:Promoted|Sponsored|広告|プロモーション|スポンサー|Boosted|ブースト)(?:\s|$)/i.test(value) ||
        Boolean(article.querySelector('[data-testid*="placement" i]'));
  };
  const isRepost = article => {
    const socialContext = article.querySelector('[data-testid="socialContext"]');
    const value = text(socialContext);
    return /(?:reposted|repost|retweeted|retweet|リポスト|リツイート)/i.test(value);
  };
  const isOrganic = article => !isPromoted(article) && !isRepost(article);
  const articleId = article => {
    const permalink = article?.querySelector('time')?.closest('a')
        ?.getAttribute('href');
    return permalink?.match(/\/status\/(\d+)/)?.[1] || '';
  };
  const articleForId = id => Array.from(
      document.querySelectorAll('article[data-testid="tweet"]'))
      .find(article => articleId(article) === id);
  const requestTrustedLike = (id, button) => {
    const bridge = globalThis.chrome?.webview;
    if (!bridge || typeof bridge.postMessage !== 'function') return false;
    const rect = button.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    const x = Math.round(rect.left + rect.width / 2);
    const y = Math.round(rect.top + rect.height / 2);
    if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return false;
    bridge.postMessage(`homepanel:x-like:${id}:${x}:${y}`);
    return true;
  };

  const run = async () => {
    try {
      if (document.readyState === 'loading') {
        await new Promise(resolve => document.addEventListener(
            'DOMContentLoaded', resolve, { once: true }));
      }

      let tab = followingTab();
      while (!tab && performance.now() < deadline) {
        state.result = 'waiting-login';
        await sleep(1000);
        tab = followingTab();
      }
      if (!tab) {
        state.result = 'login-timeout';
        return;
      }
      state.result = 'authenticated';

      if (tab.getAttribute('aria-selected') !== 'true') {
        tab.click();
        await sleep(1600);
      }

      if (followingTab()?.getAttribute('aria-selected') !== 'true') {
        state.result = 'following-unavailable';
        return;
      }

      window.scrollTo(0, 0);
      await sleep(1200);
      let nextLikeAt = performance.now() + likeIntervalMs;
      const attempted = new Set();
      state.attemptedCount = 0;
      state.likedCount = 0;
      while (performance.now() < deadline) {
        if (followingTab()?.getAttribute('aria-selected') !== 'true') break;
        if (performance.now() >= nextLikeAt) {
          const articles = Array.from(
              document.querySelectorAll('article[data-testid="tweet"]'));
          for (const article of articles) {
            if (followingTab()?.getAttribute('aria-selected') !== 'true') break;
            if (!article.isConnected || !isOrganic(article)) continue;
            const rect = article.getBoundingClientRect();
            if (rect.bottom <= 0 || rect.top >= innerHeight) continue;
            const id = articleId(article);
            if (!id || attempted.has(id)) continue;
            const button = article.querySelector('[data-testid="like"]');
            if (!button || button.disabled ||
                button.getAttribute('aria-disabled') === 'true' ||
                article.querySelector('[data-testid="unlike"]')) continue;
            if (!requestTrustedLike(id, button)) continue;
            // One trusted input request per interval. Never catch up with bursts.
            attempted.add(id);
            state.attemptedCount = attempted.size;
            nextLikeAt = performance.now() + likeIntervalMs;
            await sleep(1500);
            if (articleForId(id)?.querySelector('[data-testid="unlike"]'))
              state.likedCount++;
            break;
          }
        }
        if (performance.now() >= deadline ||
            followingTab()?.getAttribute('aria-selected') !== 'true') break;

        const scrollDistance = Math.max(
            20,
            Math.floor(innerHeight * 0.06));
        window.scrollBy({ top: scrollDistance, behavior: 'smooth' });
        await sleep(1000);
      }
      state.attemptedCount = attempted.size;
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
