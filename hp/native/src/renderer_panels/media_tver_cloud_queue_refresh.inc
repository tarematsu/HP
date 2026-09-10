// Periodically reconcile the active TVer episode queue with the cloud feed.
// The current episode and already-played prefix are preserved; only the
// remaining queue is replaced, so refresh never interrupts active playback.
namespace {
constexpr wchar_t kNativeMediaTverCloudQueueRefreshScript[] = LR"JS(
(() => {
  if (location.hostname !== 'tver.jp' ||
      !location.pathname.startsWith('/episodes/')) return null;

  const feedUrl = 'https://homepanel-cloud.tarematsu.workers.dev/v1/native/tver-feed';
  const checkIntervalMs = 30 * 60 * 1000;
  const checkedAtKey = '__homePanelTverCloudFeedCheckedAt';
  const generatedAtKey = '__homePanelTverCloudFeedGeneratedAt';
  const seriesPathKey = '__homePanelTverSeriesPath';
  const now = Date.now();

  try {
    const checkedAt = Number(sessionStorage.getItem(checkedAtKey) || '0');
    if (Number.isFinite(checkedAt) && checkedAt > 0 &&
        now - checkedAt < checkIntervalMs) {
      return null;
    }
    // Set before fetch so a transient failure cannot trigger a request every
    // 30-second watchdog tick.
    sessionStorage.setItem(checkedAtKey, String(now));
  } catch (_) {
    return null;
  }

  const normalizeEpisodeUrl = value => {
    try {
      const url = new URL(String(value || ''), location.href);
      if (url.protocol !== 'https:' || url.hostname !== 'tver.jp') return '';
      if (!/^\/episodes\/[A-Za-z0-9_-]+\/?$/.test(url.pathname)) return '';
      url.pathname = url.pathname.replace(/\/$/, '');
      url.search = '';
      url.hash = '';
      return url.toString();
    } catch (_) {
      return '';
    }
  };

  void fetch(feedUrl, {
    cache: 'no-store',
    credentials: 'omit',
    headers: { Accept: 'application/json' },
  })
    .then(response => {
      if (!response.ok) throw new Error('feed unavailable');
      return response.json();
    })
    .then(feed => {
      if (!feed || !Array.isArray(feed.episodes)) return;
      const generatedAtMs = Date.parse(feed.generatedAt || '');
      if (!Number.isFinite(generatedAtMs)) return;

      let previousGeneratedAtMs = Number.NaN;
      try {
        previousGeneratedAtMs = Date.parse(
          sessionStorage.getItem(generatedAtKey) || ''
        );
      } catch (_) {
        return;
      }
      if (Number.isFinite(previousGeneratedAtMs) &&
          generatedAtMs <= previousGeneratedAtMs) {
        return;
      }

      const fresh = [];
      const freshSeen = new Set();
      for (const episode of feed.episodes) {
        const url = normalizeEpisodeUrl(episode && episode.url);
        if (!url || freshSeen.has(url)) continue;
        freshSeen.add(url);
        fresh.push(url);
      }
      if (!fresh.length) return;

      let seriesPath = '';
      try {
        seriesPath = sessionStorage.getItem(seriesPathKey) || '';
      } catch (_) {
        return;
      }
      if (!/^\/series\/[A-Za-z0-9]+$/.test(seriesPath)) return;

      const queueKey = '__homePanelTverEpisodeQueue:' + seriesPath;
      let queue;
      try {
        queue = JSON.parse(sessionStorage.getItem(queueKey) || 'null');
      } catch (_) {
        return;
      }
      if (!queue || !Array.isArray(queue.hrefs) || !queue.hrefs.length) return;

      const currentIndex = queue.hrefs.findIndex(href => {
        const normalized = normalizeEpisodeUrl(href);
        if (!normalized) return false;
        try { return new URL(normalized).pathname === location.pathname; }
        catch (_) { return false; }
      });
      if (currentIndex < 0) return;

      const prefix = queue.hrefs
        .slice(0, currentIndex + 1)
        .map(normalizeEpisodeUrl)
        .filter(Boolean);
      if (!prefix.length ||
          new URL(prefix[prefix.length - 1]).pathname !== location.pathname) {
        return;
      }

      const seen = new Set(prefix);
      const remaining = fresh.filter(url => !seen.has(url));
      const hrefs = prefix.concat(remaining);
      try {
        sessionStorage.setItem(
          queueKey,
          JSON.stringify({ hrefs, index: prefix.length - 1 })
        );
        sessionStorage.setItem(
          generatedAtKey,
          new Date(generatedAtMs).toISOString()
        );
      } catch (_) {
      }
    })
    .catch(() => {});

  return null;
})()
)JS";
}  // namespace
