// TVer cloud-feed bootstrap. The existing static TVer player remains the sole
// playback controller; this script only selects a collected episode before it runs.
constexpr wchar_t kNativeMediaTverCloudFeedBootstrapScript[] = LR"JS(
(() => {
  const cloudFeedUrl = 'https://homepanel-cloud.tarematsu.workers.dev/v1/native/tver-feed';
  const sakuraSeriesPath = '/series/srx97ftk3w';
  const deathGameSeriesPath = '/series/srkzm5wbvp';
  const fallbackSeries = new Set([sakuraSeriesPath, deathGameSeriesPath]);
  const cacheKey = '__homePanelTverCloudFeedCache';
  const lastPlayedKey = '__homePanelTverCloudLastPlayed';
  const badEpisodesKey = '__homePanelTverCloudBadEpisodes';
  const fallbackOnceKey = '__homePanelTverCloudFallbackOnce';
  const failureUntilKey = '__homePanelTverCloudFailureUntil';
  const cacheMs = 30 * 60 * 1000;
  const maxFeedAgeMs = 12 * 60 * 60 * 1000;
  const failureBackoffMs = 30 * 60 * 1000;
  const path = location.pathname;

  const sessionGet = key => {
    try { return sessionStorage.getItem(key) || ''; } catch (_) { return ''; }
  };
  const sessionSet = (key, value) => {
    try { sessionStorage.setItem(key, value); } catch (_) {}
  };
  const sessionRemove = key => {
    try { sessionStorage.removeItem(key); } catch (_) {}
  };
  const normalizeEpisodeUrl = value => {
    try {
      const url = new URL(value, location.origin);
      if (url.protocol !== 'https:' || url.hostname !== 'tver.jp' ||
          !/^\/episodes\/[A-Za-z0-9_-]+\/?$/.test(url.pathname)) return '';
      url.pathname = url.pathname.replace(/\/$/, '');
      url.search = '';
      url.hash = '';
      return url.href;
    } catch (_) {
      return '';
    }
  };
  const pathOf = value => {
    try { return new URL(value, location.origin).pathname.replace(/\/$/, ''); }
    catch (_) { return ''; }
  };
  const readBadEpisodes = () => {
    try {
      const parsed = JSON.parse(sessionGet(badEpisodesKey) || '[]');
      return new Set(Array.isArray(parsed) ? parsed.filter(value => typeof value === 'string') : []);
    } catch (_) {
      return new Set();
    }
  };
  const markBadEpisode = episodePath => {
    if (!episodePath) return;
    const bad = readBadEpisodes();
    bad.add(episodePath);
    sessionSet(badEpisodesKey, JSON.stringify([...bad].slice(-100)));
  };
  const readCachedFeed = () => {
    try {
      const parsed = JSON.parse(sessionGet(cacheKey) || 'null');
      if (!parsed || !Array.isArray(parsed.urls) || !Number.isFinite(parsed.cachedAt)) return null;
      if (Date.now() - parsed.cachedAt > cacheMs) return null;
      const urls = [...new Set(parsed.urls.map(normalizeEpisodeUrl).filter(Boolean))];
      if (!urls.length) return null;
      return { urls, generatedAt: parsed.generatedAt || '', cachedAt: parsed.cachedAt };
    } catch (_) {
      return null;
    }
  };
  const feedFromPayload = payload => {
    if (!payload || !Array.isArray(payload.episodes)) return null;
    const generatedAtMs = Date.parse(payload.generatedAt || '');
    if (!Number.isFinite(generatedAtMs) || Date.now() - generatedAtMs > maxFeedAgeMs ||
        generatedAtMs - Date.now() > 60 * 60 * 1000) return null;
    const urls = [...new Set(payload.episodes
        .map(item => normalizeEpisodeUrl(item && item.url))
        .filter(Boolean))];
    return urls.length ? { urls, generatedAt: payload.generatedAt, cachedAt: Date.now() } : null;
  };
  const fallbackToCurrentSeries = () => {
    sessionSet(failureUntilKey, String(Date.now() + failureBackoffMs));
    sessionSet(fallbackOnceKey, '1');
    location.reload();
  };
  const navigateNextCollectedEpisode = feed => {
    const bad = readBadEpisodes();
    const usable = feed.urls.filter(url => !bad.has(pathOf(url)));
    if (!usable.length) {
      fallbackToCurrentSeries();
      return;
    }
    const lastPlayed = sessionGet(lastPlayedKey);
    const currentIndex = usable.findIndex(url => pathOf(url) === lastPlayed);
    const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % usable.length : 0;
    sessionRemove('__homePanelTverEpisodeQueue:' + sakuraSeriesPath);
    sessionRemove('__homePanelTverEpisodeQueue:' + deathGameSeriesPath);
    location.replace(usable[nextIndex]);
  };

  // Direct cloud-feed episode: let the existing TVer playback script own all
  // play/rate/ad/fullscreen/end handling. Only guard dead/expired episode URLs.
  if (/^\/episodes\/[A-Za-z0-9_-]+\/?$/.test(path)) {
    const episodePath = path.replace(/\/$/, '');
    sessionSet(lastPlayedKey, episodePath);
    let checks = 0;
    const guard = window.setInterval(() => {
      if (location.pathname.replace(/\/$/, '') !== episodePath) {
        window.clearInterval(guard);
        return;
      }
      const video = Array.from(document.querySelectorAll('video')).find(element => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
      }) || document.querySelector('video');
      if (video && (video.readyState > 0 || Number.isFinite(video.duration))) {
        window.clearInterval(guard);
        return;
      }
      const text = (document.body?.innerText || '').replace(/\s+/g, ' ');
      const unavailable = /この動画の配信は終了しました|配信終了しました|動画を再生できません|ページが見つかりません/.test(text);
      checks += 1;
      if (!unavailable && checks < 12) return;
      window.clearInterval(guard);
      markBadEpisode(episodePath);
      location.replace(sakuraSeriesPath);
    }, 5000);
    return;
  }

  if (!fallbackSeries.has(path)) return;

  // One reload after a cloud failure intentionally falls through to the current
  // fixed-series implementation. Further attempts are backed off for 30 minutes.
  if (sessionGet(fallbackOnceKey) === '1') {
    sessionRemove(fallbackOnceKey);
    return;
  }
  const failureUntil = Number(sessionGet(failureUntilKey) || 0);
  if (Number.isFinite(failureUntil) && failureUntil > Date.now()) return;

  // Prevent the legacy series script from selecting its own episode while the
  // cloud feed is being resolved. A failed resolution reloads and re-enables it.
  window.__homePanelSakuraMeetsLoopInstalled = true;
  const cached = readCachedFeed();
  if (cached) {
    navigateNextCollectedEpisode(cached);
    return;
  }

  fetch(cloudFeedUrl, { method: 'GET', cache: 'no-store', credentials: 'omit' })
    .then(response => {
      if (!response.ok) throw new Error('feed HTTP ' + response.status);
      return response.json();
    })
    .then(payload => {
      const feed = feedFromPayload(payload);
      if (!feed) throw new Error('invalid or stale feed');
      sessionSet(cacheKey, JSON.stringify(feed));
      sessionRemove(failureUntilKey);
      navigateNextCollectedEpisode(feed);
    })
    .catch(() => fallbackToCurrentSeries());
})()
)JS";
