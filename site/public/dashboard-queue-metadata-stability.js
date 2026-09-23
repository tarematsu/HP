(() => {
  const nativeFetch = window.fetch.bind(window);
  const DASHBOARD_CACHE_KEY = 'sh.dashboard.v3';
  const TITLE_PLACEHOLDERS = new Set([
    '曲名不明', '曲名…', '曲名...', 'unknown', 'unknown title', '_', '-', '—',
  ]);
  const ARTIST_PLACEHOLDERS = new Set([
    'アーティスト不明', 'unknown', 'unknown artist', '_', '-', '—',
  ]);
  const known = new Map();

  function normalizedText(value) {
    return String(value ?? '').trim();
  }

  function usableText(value, placeholders) {
    const text = normalizedText(value);
    if (!text) return '';
    return placeholders.has(text.normalize('NFKC').toLowerCase()) ? '' : text;
  }

  function trackKey(track) {
    const spotifyId = normalizedText(track?.spotify_id);
    if (spotifyId) return `spotify:${spotifyId}`;

    const spotifyUrl = normalizedText(track?.spotify_url);
    if (spotifyUrl) {
      const match = /open\.spotify\.com\/track\/([A-Za-z0-9]+)/i.exec(spotifyUrl);
      if (match?.[1]) return `spotify:${match[1]}`;
    }

    const artist = usableText(track?.artist, ARTIST_PLACEHOLDERS);
    const thumbnail = normalizedText(track?.thumbnail_url);
    const duration = Number(track?.duration_ms);
    if (artist && thumbnail && Number.isFinite(duration) && duration > 0) {
      return `media:${artist}\u0000${thumbnail}\u0000${Math.round(duration)}`;
    }
    return '';
  }

  function remember(track) {
    const key = trackKey(track);
    if (!key) return;
    const previous = known.get(key) || {};
    const title = usableText(track?.title, TITLE_PLACEHOLDERS) || previous.title || '';
    const artist = usableText(track?.artist, ARTIST_PLACEHOLDERS) || previous.artist || '';
    const thumbnailUrl = normalizedText(track?.thumbnail_url) || previous.thumbnail_url || '';
    if (!title && !artist && !thumbnailUrl) return;
    known.set(key, {
      title,
      artist,
      thumbnail_url: thumbnailUrl,
    });
  }

  function stabilizeTrack(track) {
    if (!track || typeof track !== 'object') return track;
    const key = trackKey(track);
    const previous = key ? known.get(key) : null;
    if (!previous) {
      remember(track);
      return track;
    }

    const title = usableText(track.title, TITLE_PLACEHOLDERS) || previous.title || null;
    const artist = usableText(track.artist, ARTIST_PLACEHOLDERS) || previous.artist || null;
    const thumbnailUrl = normalizedText(track.thumbnail_url) || previous.thumbnail_url || null;
    const stabilized = {
      ...track,
      title,
      artist,
      thumbnail_url: thumbnailUrl,
    };
    remember(stabilized);
    return stabilized;
  }

  function stabilizeQueue(queue) {
    if (!Array.isArray(queue)) return queue;
    return queue.map(stabilizeTrack);
  }

  function learnQueue(queue) {
    if (!Array.isArray(queue)) return;
    for (const track of queue) remember(track);
  }

  function restoreKnownMetadata() {
    try {
      const cached = JSON.parse(localStorage.getItem(DASHBOARD_CACHE_KEY) || 'null');
      learnQueue(cached?.payload?.queue);
    } catch {}
  }

  function dashboardRequest(input) {
    const raw = typeof input === 'string' || input instanceof URL ? String(input) : input?.url;
    if (!raw) return false;
    try {
      const url = new URL(raw, location.href);
      return url.origin === location.origin && url.pathname === '/api/dashboard';
    } catch {
      return false;
    }
  }

  function responseWithPayload(response, payload) {
    const headers = new Headers(response.headers);
    headers.delete('content-length');
    const snapshot = structuredClone(payload);
    const next = new Response(JSON.stringify(snapshot), {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
    try {
      Object.defineProperty(next, 'json', {
        configurable: true,
        value: async () => structuredClone(snapshot),
      });
    } catch {}
    return next;
  }

  restoreKnownMetadata();
  window.addEventListener('dashboard:payload', (event) => {
    learnQueue(event?.detail?.payload?.queue);
  });

  window.fetch = async (input, init = {}) => {
    const response = await nativeFetch(input, init);
    if (!dashboardRequest(input) || !response.ok) return response;
    try {
      const payload = await response.clone().json();
      if (!payload?.ok || !Array.isArray(payload.queue)) return response;
      payload.queue = stabilizeQueue(payload.queue);
      return responseWithPayload(response, payload);
    } catch {
      return response;
    }
  };
})();
