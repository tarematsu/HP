LR"JS(
;
(() => {
  if (!/^(?:www\.)?x\.com$/.test(location.hostname)) return false;

  const state = window.__homePanelXLikeRuntime ||
      (window.__homePanelXLikeRuntime = {});
  if (state.started) return true;
  state.started = true;
  const deadline = performance.now() + 120 * 1000;
  const likeWaitChoicesMs = [5 * 1000, 10 * 1000, 15 * 1000, 20 * 1000];
  const maxLikeAttemptsPerPost = 3;
  const pauseAfterLikeMs = 800;
  const scrollDelayMs = 450;
  const idleScrollDelayMs = 600;
  const maxScrollStepPx = 56;
  const minScrollStepPx = 20;
  const targetTolerancePx = 18;
  const filterAttribute = 'data-homepanel-x-filtered';
  const filterStyleId = 'homepanel-x-timeline-filter';

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const randomLikeWaitMs = () => likeWaitChoicesMs[
      Math.floor(Math.random() * likeWaitChoicesMs.length)];
  const text = element => (element?.innerText || element?.textContent || '')
      .replace(/\s+/g, ' ').trim();
  const timelineArticles = () => Array.from(
      document.querySelectorAll('article[data-testid="tweet"]'));
  const followingTab = () => Array.from(document.querySelectorAll('[role="tab"]'))
      .find(tab => /^(?:Following|フォロー中)$/i.test(text(tab)));

  const startupRequested =
      /(?:^|[?&])homepanel=startup(?:&|$)/.test(String(location.search || ''));
  if (startupRequested) {
    const startupKey = 'homepanel:startup-x-until:v2';
    const youtubeStart =
        'https://homepanel-cloud.tarematsu.workers.dev/v1/native/youtube-start';
    let startupUntil = 0;
    try { startupUntil = Number(sessionStorage.getItem(startupKey) || 0); }
    catch (_) {}
    if (!Number.isFinite(startupUntil) || startupUntil <= Date.now()) {
      startupUntil = Date.now() + 120 * 1000;
      try { sessionStorage.setItem(startupKey, String(startupUntil)); }
      catch (_) {}
    }
    const remaining = startupUntil - Date.now();
    if (remaining > 0) {
      if (state.startupExitTimer) clearTimeout(state.startupExitTimer);
      state.startupExitTimer = setTimeout(() => {
        try { sessionStorage.removeItem(startupKey); } catch (_) {}
        location.assign(youtubeStart);
      }, remaining);
    } else {
      try { sessionStorage.removeItem(startupKey); } catch (_) {}
    }
  }

  const promotedLabel = /^(?:Promoted|Sponsored|広告|プロモーション|スポンサー|Boosted|ブースト|PR)$/i;
  const hasPromotedLabel = article => Array.from(article?.querySelectorAll?.('span') || [])
      .some(element => !element.closest?.('[data-testid="tweetText"]') &&
          promotedLabel.test(text(element)));
  const isPromoted = article => hasPromotedLabel(article) ||
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
      article[data-testid="tweet"]:has([data-testid*="placement" i]),
      [data-testid="cellInnerDiv"]:has(article[data-testid="tweet"] [data-testid*="placement" i]) {
        display: none !important;
      }
    `;
    root.appendChild(style);
  };
  const markFilteredArticles = () => {
    for (const article of timelineArticles()) {
      const target = article.closest?.('[data-testid="cellInnerDiv"]') || article;
      if (isPromoted(article) || isRepost(article)) {
        target.setAttribute?.(filterAttribute, 'true');
      } else {
        target.removeAttribute?.(filterAttribute);
      }
    }
  };
)JS"
LR"JS(
  const articleId = article => {
    const permalink = article?.querySelector('time')?.closest('a')
        ?.getAttribute('href');
    return permalink?.match(/\/status\/(\d+)/)?.[1] || '';
  };
  const articleForId = id => timelineArticles()
      .find(article => articleId(article) === id);
  const validLikeButton = article => {
    const button = article?.querySelector?.('[data-testid="like"]');
    if (!button || button.disabled ||
        button.getAttribute('aria-disabled') === 'true' ||
        article.querySelector('[data-testid="unlike"]')) return null;
    const rect = button.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return null;
    return { button, rect };
  };
  const targetY = () => Math.round(innerHeight * 0.62);
  const findNextCandidate = attempted => {
    const preferredFloor = targetY() - targetTolerancePx;
    const candidates = [];
    for (const article of timelineArticles()) {
      if (!article.isConnected || !isOrganic(article)) continue;
      const id = articleId(article);
      if (!id || attempted.has(id)) continue;
      const like = validLikeButton(article);
      if (!like) continue;
      const centerY = like.rect.top + like.rect.height / 2;
      if (centerY < preferredFloor) continue;
      candidates.push({ article, id, button: like.button, centerY });
    }
    candidates.sort((a, b) => a.centerY - b.centerY);
    return candidates[0] || null;
  };
  const clickLikeButton = button => {
    if (!button || typeof button.click !== 'function') return false;
    try {
      button.click();
      return true;
    } catch (_) {
      return false;
    }
  };
)JS"
LR"JS(
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
      const attempted = new Set();
      const failedAttempts = new Map();
      state.attemptedCount = 0;
      state.likedCount = 0;
      state.clickCount = 0;
      state.unconfirmedCount = 0;
      state.likeWaitHistoryMs = [];
      while (performance.now() < deadline) {
        markFilteredArticles();
        if (followingTab()?.getAttribute('aria-selected') !== 'true') break;

        const articles = timelineArticles();
        const candidate = findNextCandidate(attempted);
        if (!candidate) {
          if (articles.length === 0) {
            state.result = 'waiting-posts';
            await sleep(idleScrollDelayMs);
            continue;
          }
          state.result = 'seeking-like';
          window.scrollBy({ top: maxScrollStepPx, behavior: 'smooth' });
          await sleep(idleScrollDelayMs);
          continue;
        }

        const distance = candidate.centerY - targetY();
        if (Math.abs(distance) > targetTolerancePx) {
          state.result = 'approaching-like';
          const step = Math.max(
              minScrollStepPx,
              Math.min(maxScrollStepPx, Math.ceil(Math.abs(distance) * 0.70)));
          window.scrollBy({ top: Math.sign(distance) * step, behavior: 'smooth' });
          await sleep(scrollDelayMs);
          continue;
        }

        state.result = 'paused-on-like';
        const waitMs = randomLikeWaitMs();
        state.lastLikeWaitMs = waitMs;
        state.likeWaitHistoryMs.push(waitMs);
        state.result = 'waiting-before-like';
        await sleep(waitMs);
        if (performance.now() >= deadline ||
            followingTab()?.getAttribute('aria-selected') !== 'true') break;

        const freshArticle = articleForId(candidate.id);
        if (!freshArticle || !freshArticle.isConnected || !isOrganic(freshArticle))
          continue;
        const freshLike = validLikeButton(freshArticle);
        if (!freshLike) continue;
        const freshCenterY = freshLike.rect.top + freshLike.rect.height / 2;
        if (Math.abs(freshCenterY - targetY()) > targetTolerancePx) continue;

        if (!clickLikeButton(freshLike.button)) {
          const failures = (failedAttempts.get(candidate.id) || 0) + 1;
          failedAttempts.set(candidate.id, failures);
          state.unconfirmedCount++;
          state.result = 'like-click-unavailable';
          if (failures >= maxLikeAttemptsPerPost) {
            attempted.add(candidate.id);
            state.attemptedCount = attempted.size;
            failedAttempts.delete(candidate.id);
          }
          await sleep(pauseAfterLikeMs);
          continue;
        }

        state.clickCount++;
        state.result = 'like-clicked';
        await sleep(1500);
        const confirmed = Boolean(
            articleForId(candidate.id)?.querySelector('[data-testid="unlike"]'));
        if (confirmed) {
          attempted.add(candidate.id);
          failedAttempts.delete(candidate.id);
          state.attemptedCount = attempted.size;
          state.likedCount++;
          state.result = 'like-confirmed';
        } else {
          const failures = (failedAttempts.get(candidate.id) || 0) + 1;
          failedAttempts.set(candidate.id, failures);
          state.unconfirmedCount++;
          state.result = 'like-unconfirmed';
          if (failures >= maxLikeAttemptsPerPost) {
            attempted.add(candidate.id);
            state.attemptedCount = attempted.size;
            failedAttempts.delete(candidate.id);
          }
        }
        await sleep(pauseAfterLikeMs);
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
