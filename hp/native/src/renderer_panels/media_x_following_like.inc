LR"JS(
;
(() => {
  if (!/^(?:www\.)?x\.com$/.test(location.hostname)) return false;

  const state = window.__homePanelXLikeRuntime ||
      (window.__homePanelXLikeRuntime = {});
  if (state.started) return true;
  state.started = true;
  const deadline = performance.now() + 120 * 1000;
  const likeWaitChoicesMs = [4 * 1000, 7 * 1000, 9 * 1000];
  const maxLikeAttemptsPerPost = 3;
  const pauseAfterLikeMs = 800;
  // 1.25x scroll distance per tick; retain original DOM scan cadence.
  const scrollDelayMs = 450;
  const idleScrollDelayMs = 600;
  const emptyTimelinePollMs = 600;
  const maxScrollStepPx = 56;
  const minScrollStepPx = 20;
  const targetTolerancePx = 18;
  const filterAttribute = 'data-homepanel-x-filtered';
  const filterStyleId = 'homepanel-x-timeline-filter';

  // Remember confirmed likes by the tweet author's @handle across restarts.
  // Do not rely on display names or text mentions: only the tweet permalink
  // identifies the author. Entries expire exactly 48 hours after confirmation.
  const accountStorageKey = 'homepanel:x-liked-authors:48h:v1';
  const accountCooldownMs = 48 * 60 * 60 * 1000;
  const likedAuthors = new Map();
  const validAuthor = handle => /^@[a-z0-9_]{1,15}$/.test(handle);
  const activeTimestamp = (timestamp, now) =>
      Number.isFinite(timestamp) && timestamp > 0 && timestamp <= now &&
      now - timestamp < accountCooldownMs;
  const saveLikedAuthors = () => {
    try {
      localStorage.setItem(accountStorageKey,
          JSON.stringify(Object.fromEntries(likedAuthors)));
      state.authorHistoryPersisted = true;
    } catch (_) {
      state.authorHistoryPersisted = false;
    }
  };
  try {
    const saved = JSON.parse(localStorage.getItem(accountStorageKey) || '{}');
    if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
      const now = Date.now();
      for (const [handle, timestamp] of Object.entries(saved)) {
        const normalized = handle.toLowerCase();
        if (validAuthor(normalized) && activeTimestamp(timestamp, now))
          likedAuthors.set(normalized, timestamp);
      }
      // Also discard expired/corrupt entries from persistent storage.
      if (Object.keys(saved).length !== likedAuthors.size) saveLikedAuthors();
    }
  } catch (_) {}
  const recentlyLikedAuthor = handle => {
    if (!validAuthor(handle)) return true; // unknown authors are not safe to like
    const timestamp = likedAuthors.get(handle);
    if (timestamp === undefined) return false;
    if (activeTimestamp(timestamp, Date.now())) return true;
    likedAuthors.delete(handle);
    saveLikedAuthors();
    return false;
  };
  const rememberLikedAuthor = handle => {
    if (!validAuthor(handle)) return;
    likedAuthors.set(handle, Date.now());
    saveLikedAuthors();
  };


  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const randomLikeWaitMs = () => likeWaitChoicesMs[
      Math.floor(Math.random() * likeWaitChoicesMs.length)];
  const text = element => (element?.innerText || element?.textContent || '')
      .replace(/\s+/g, ' ').trim();
  // Iterate static NodeLists directly instead of copying them every tick.
  const timelineArticles = () =>
      document.querySelectorAll('article[data-testid="tweet"]');
  const followingTab = () => {
    // X rebuilds the navigation tabs on route changes. Reuse the connected
    // Following tab while its caption is unchanged, without querying every tab
    // or forcing layout through innerText on each scroll/like recheck.
    const cached = state.followingTab;
    if (cached?.isConnected !== false) {
      const caption = (cached?.textContent ?? cached?.innerText ?? '')
          .replace(/\s+/g, ' ').trim();
      if (/^(?:Following|フォロー中)$/i.test(caption)) return cached;
    }
    state.followingTab = null;
    for (const tab of document.querySelectorAll('[role="tab"]')) {
      if (/^(?:Following|フォロー中)$/i.test(text(tab))) {
        state.followingTab = tab;
        return tab;
      }
    }
    return null;
  };

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
  const hasPromotedLabel = article => {
    for (const element of article?.querySelectorAll?.('span') || []) {
      // textContent does not trigger layout. The actual label is still
      // validated against rendered text before marking a post as promoted.
      const raw = element.textContent;
      if (raw && !promotedLabel.test(raw.replace(/\s+/g, ' ').trim()))
        continue;
      if (!element.closest?.('[data-testid="tweetText"]') &&
          promotedLabel.test(text(element))) return true;
    }
    return false;
  };
  const isPromoted = article =>
      Boolean(article.querySelector('[data-testid*="placement" i]')) ||
      hasPromotedLabel(article);
  const repostPattern =
      /(?:reposted|repost|retweeted|retweet|リポスト|リツイート)/i;
  const isRepost = article => {
    const socialContext = article.querySelector('[data-testid="socialContext"]');
    if (!socialContext) return false;
    // Avoid reading innerText for pinned/other non-repost social contexts.
    const raw = socialContext.textContent;
    if (raw && !repostPattern.test(raw)) return false;
    return repostPattern.test(text(socialContext));
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
)JS"
LR"JS(
  const articleIdentity = article => {
    const permalink = article?.querySelector('time')?.closest('a')
        ?.getAttribute('href');
    const match = permalink?.match(
        /^(?:https?:\/\/(?:www\.)?(?:x|twitter)\.com)?\/([a-z0-9_]{1,15})\/status\/(\d+)(?:[/?#]|$)/i);
    return match ? { id: match[2], author: '@' + match[1].toLowerCase() } : null;
  };
  const articleId = article => articleIdentity(article)?.id || '';
  const articleForId = id => {
    for (const article of timelineArticles()) {
      if (articleId(article) === id) return article;
    }
    return null;
  };
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
  // Filter and select from one fresh timeline snapshot. Previously the room
  // was queried three times per scroll tick, and eligible posts were sorted.
  const scanTimeline = (articles, attempted = null) => {
    const preferredFloor = attempted ? targetY() - targetTolerancePx : 0;
    let nearest = null;
    for (const article of articles) {
      const filtered = isPromoted(article) || isRepost(article);
      // Hiding the existing parent cell collapses the space consumed by a
      // recently liked author's posts. Do NOT remove X-owned DOM nodes:
      // React's virtualized timeline relies on those nodes and their keys.
      const identity = !filtered && likedAuthors.size
          ? articleIdentity(article) : null;
      const authorFiltered = !!(identity && likedAuthors.has(identity.author) &&
          recentlyLikedAuthor(identity.author));
      const hidden = filtered || authorFiltered;
      const target = article.closest?.('[data-testid="cellInnerDiv"]') || article;
      // A recycled cell or expired 48h entry becomes visible again.
      // Avoid repeated attribute writes that trigger style recalculation.
      if (hidden) {
        if (target.getAttribute?.(filterAttribute) !== 'true') {
          target.setAttribute?.(filterAttribute, 'true');
        }
      } else if (target.hasAttribute?.(filterAttribute)) {
        target.removeAttribute?.(filterAttribute);
      }
      if (!attempted || hidden || !article.isConnected) continue;
      const eligible = identity || articleIdentity(article);
      if (!eligible || attempted.has(eligible.id) ||
          recentlyLikedAuthor(eligible.author)) continue;
      const like = validLikeButton(article);
      if (!like) continue;
      const centerY = like.rect.top + like.rect.height / 2;
      if (centerY < preferredFloor ||
          (nearest && centerY >= nearest.centerY)) continue;
      nearest = { article, id: eligible.id, author: eligible.author,
                  button: like.button, centerY };
    }
    return nearest;
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
      scanTimeline(timelineArticles());

      let tab = followingTab();
      while (!tab && performance.now() < deadline) {
        state.result = 'waiting-login';
        scanTimeline(timelineArticles());
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
        const articles = timelineArticles();
        const candidate = scanTimeline(articles, attempted);
        if (followingTab()?.getAttribute('aria-selected') !== 'true') break;
        if (!candidate) {
          if (articles.length === 0) {
            state.result = 'waiting-posts';
            await sleep(emptyTimelinePollMs);
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
        const freshIdentity = articleIdentity(freshArticle);
        if (!freshIdentity || freshIdentity.id !== candidate.id ||
            freshIdentity.author !== candidate.author ||
            recentlyLikedAuthor(freshIdentity.author)) continue;
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
          rememberLikedAuthor(candidate.author);
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
