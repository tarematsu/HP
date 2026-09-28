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
            const permalink = article.querySelector('time')?.closest('a')
                ?.getAttribute('href');
            const id = permalink?.match(/\/status\/(\d+)/)?.[1];
            if (!id || attempted.has(id)) continue;
            const button = article.querySelector('[data-testid="like"]');
            if (!button || button.disabled ||
                button.getAttribute('aria-disabled') === 'true' ||
                article.querySelector('[data-testid="unlike"]')) continue;
            // Never retry a failed post or catch up with a burst of clicks.
            attempted.add(id);
            state.attemptedCount = attempted.size;
            nextLikeAt = performance.now() + likeIntervalMs;
            button.click();
            await sleep(1000);
            if (article.querySelector('[data-testid="unlike"]')) state.likedCount++;
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
