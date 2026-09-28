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
  const filterAttribute = 'data-homepanel-x-filtered';
  const filterStyleId = 'homepanel-x-timeline-filter';

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const text = element => (element?.innerText || element?.textContent || '')
      .replace(/\s+/g, ' ').trim();
  const followingTab = () => Array.from(document.querySelectorAll('[role="tab"]'))
      .find(tab => /^(?:Following|フォロー中)$/i.test(text(tab)));
  const promotedLabel = /^(?:Promoted|Sponsored|広告|プロモーション|スポンサー|Boosted|ブースト|PR)$/i;
  const promotedText = /(?:^|\s)(?:Promoted|Sponsored|広告|プロモーション|スポンサー|Boosted|ブースト|PR)(?:\s|$)/i;
  const hasPromotedLabel = article => Array.from(article?.querySelectorAll?.('span') || [])
      .some(element => promotedLabel.test(text(element)));
  const isPromoted = article => promotedText.test(text(article)) ||
      hasPromotedLabel(article) ||
      Boolean(article.querySelector('[data-testid*="placement" i]'));
  const isRepost = article => {
    const socialContext = article.querySelector('[data-testid="socialContext"]');
    const value = text(socialContext);
    return /(?:reposted|repost|retweeted|retweet|リポスト|リツイート)/i.test(value);
  };
  const isOrganic = article => !isPromoted(article) && !isRepost(article);
  const installTimelineFilterCss = () => {
    const root = document.head || document.documentElement;
    if (!root || document.getElementById?.(filterStyleId) ||
        typeof document.createElement !== 'function') return;
    const style = document.createElement('style');
    style.id = filterStyleId;
    style.textContent = `
      [${filterAttribute}="true"],
      article[data-testid="tweet"]:has([data-testid="socialContext"]),
      article[data-testid="tweet"]:has([data-testid*="placement" i]),
      [data-testid="cellInnerDiv"]:has(article[data-testid="tweet"] [data-testid="socialContext"]),
      [data-testid="cellInnerDiv"]:has(article[data-testid="tweet"] [data-testid*="placement" i]) {
        display: none !important;
      }
    `;
    root.appendChild(style);
  };
  const markFilteredArticles = () => {
    const articles = Array.from(
        document.querySelectorAll('article[data-testid="tweet"]'));
    for (const article of articles) {
      const target = article.closest?.('[data-testid="cellInnerDiv"]') || article;
      if (isPromoted(article) || isRepost(article)) {
        target.setAttribute?.(filterAttribute, 'true');
      } else {
        target.removeAttribute?.(filterAttribute);
      }
    }
  };
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

      installTimelineFilterCss();
      markFilteredArticles();

      let tab = followingTab();
      while (!tab && performance.now() < deadline) {
        state.result = 'waiting-login';
        markFilteredArticles();
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
        markFilteredArticles();
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
