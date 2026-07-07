(() => {
  'use strict';

  if (window.__homepanelDashboardPerformance) return;

  const native = {
    setInterval: window.setInterval.bind(window),
    clearInterval: window.clearInterval.bind(window),
    setTimeout: window.setTimeout.bind(window),
    clearTimeout: window.clearTimeout.bind(window),
  };

  // HomePanel owns exactly three recurring dashboard jobs. Keep their normal
  // cadence while visible, but remove their native timers entirely while the
  // WebView is hidden instead of waking just to discover document.hidden.
  let nextManagedId = -1;
  const managedIntervals = new Map();

  const callbackSource = callback => {
    try {
      return typeof callback === 'function'
        ? Function.prototype.toString.call(callback)
        : String(callback);
    } catch (_) {
      return '';
    }
  };

  const managedKind = (source, delay) => {
    if (delay === 1000 && /\bupdateClock\b/.test(source)) return 'clock';
    if (delay === 5000 && /\btickSpProgress\b/.test(source)) return 'progress';
    if (delay === 5 * 60 * 1000 && /\brefreshRadar\b/.test(source)) return 'radar';
    return '';
  };

  const invoke = record => {
    if (typeof record.callback === 'function') {
      return record.callback.apply(window, record.args);
    }
    return (0, eval)(String(record.callback));
  };

  const nextDelay = record => {
    if (record.kind === 'clock') {
      return Math.max(20, 1008 - (Date.now() % 1000));
    }
    return record.delay;
  };

  const schedule = record => {
    if (!record.active || document.hidden || record.timerId) return;
    record.timerId = native.setTimeout(() => {
      record.timerId = 0;
      if (!record.active || document.hidden) return;
      try {
        invoke(record);
      } catch (error) {
        native.setTimeout(() => { throw error; }, 0);
      }
      schedule(record);
    }, nextDelay(record));
  };

  const clearManaged = id => {
    const record = managedIntervals.get(id);
    if (!record) return false;
    record.active = false;
    if (record.timerId) native.clearTimeout(record.timerId);
    managedIntervals.delete(id);
    return true;
  };

  window.setInterval = (callback, delay, ...args) => {
    const numericDelay = Math.max(0, Number(delay) || 0);
    const kind = managedKind(callbackSource(callback), numericDelay);
    if (!kind) return native.setInterval(callback, numericDelay, ...args);

    const id = nextManagedId--;
    const record = {
      kind,
      callback,
      args,
      delay: numericDelay,
      timerId: 0,
      active: true,
    };
    managedIntervals.set(id, record);
    schedule(record);
    return id;
  };

  window.clearInterval = id => {
    if (!clearManaged(id)) native.clearInterval(id);
  };
  window.clearTimeout = id => {
    if (!clearManaged(id)) native.clearTimeout(id);
  };

  document.addEventListener('visibilitychange', () => {
    for (const record of managedIntervals.values()) {
      if (record.timerId) native.clearTimeout(record.timerId);
      record.timerId = 0;
      schedule(record);
    }
  }, { passive: true });

  window.__homepanelDashboardPerformance = {
    get managedIntervalCount() { return managedIntervals.size; },
  };
})();

(() => {
  'use strict';

  if (window.__homepanelStationheadFetchNormalized) return;
  window.__homepanelStationheadFetchNormalized = true;

  const originalFetch = window.fetch.bind(window);
  const PLAYBACK_ORIGIN = 'https://skrzk.pages.dev';
  const PLAYBACK_PATH = '/api/playback';
  const nativePlaybackPayloads = new Map();

  function asObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  }

  function playbackSourceKey(input) {
    try {
      const raw = input instanceof Request ? input.url : String(input || '');
      const url = new URL(raw, location.href);
      if (url.origin !== PLAYBACK_ORIGIN || url.pathname !== PLAYBACK_PATH) return '';
      const channel = String(url.searchParams.get('channel') || 'buddies').toLowerCase();
      if (channel === 'buddy46') return 'b';
      if (channel === 'buddies') return 'a';
      return '';
    } catch (_) {
      return '';
    }
  }

  function isPlaybackRequest(input) {
    return Boolean(playbackSourceKey(input));
  }

  function firstFinite(...values) {
    for (const value of values) {
      if (value === null || value === undefined || value === '') continue;
      const number = Number(value);
      if (Number.isFinite(number)) return number;
    }
    return 0;
  }

  function validQueueIndex(queue, ...values) {
    for (const value of values) {
      if (value === null || value === undefined || value === '') continue;
      const index = Number(value);
      if (Number.isInteger(index) && index >= 0 && index < queue.length) return index;
    }
    return queue.length ? 0 : -1;
  }

  function normalizeQueueItem(raw) {
    const item = asObject(raw);
    if (!Object.keys(item).length) return item;
    const normalized = { ...item };
    if (!normalized.imageUrl && item.thumbnail_url) normalized.imageUrl = item.thumbnail_url;
    if (!normalized.artworkUrl && item.thumbnail_url) normalized.artworkUrl = item.thumbnail_url;
    return normalized;
  }

  function normalizePlaybackPayload(raw, receivedAt = Date.now()) {
    const payload = asObject(raw);
    if (!Object.keys(payload).length) return raw;

    const queueStatus = asObject(payload.queue_status || payload.queueStatus);
    const queue = Array.isArray(payload.queue) ? payload.queue : [];
    const flaggedIndex = queue.findIndex(item => asObject(item).is_current === true);
    const currentIndex = validQueueIndex(
      queue,
      payload.currentIndex,
      payload.current_index,
      queueStatus.currentIndex,
      queueStatus.current_index,
      flaggedIndex >= 0 ? flaggedIndex : undefined,
    );
    const currentItem = currentIndex >= 0 ? asObject(queue[currentIndex]) : {};
    const progressMs = Math.max(0, firstFinite(
      payload.progressMs,
      payload.progress_ms,
      payload.positionMs,
      queueStatus.progressMs,
      queueStatus.progress_ms,
      currentItem.progressMs,
      currentItem.progress_ms,
    ));
    const serverAnchorAt = firstFinite(
      payload.anchorAt,
      payload.anchor_at,
      queueStatus.anchorAt,
      queueStatus.anchor_at,
    );
    const serverQueueEndAt = firstFinite(
      payload.queueEndAt,
      payload.queue_end_at,
      queueStatus.queueEndAt,
      queueStatus.queue_end_at,
    );
    const serverReferenceAt = firstFinite(
      payload.generated_at,
      payload.latest_observed_at,
      payload.sampledAt,
      payload.monitorSampledAt,
      payload.updatedAt,
      payload.queue_observed_at,
    );

    const normalized = { ...payload };
    normalized.currentIndex = Math.max(0, currentIndex);
    normalized.current_index = Math.max(0, currentIndex);
    normalized.progressMs = progressMs;
    normalized.progress_ms = progressMs;
    normalized.positionMs = progressMs;
    normalized.sampledAt = receivedAt;

    if (serverAnchorAt > 0) {
      const serverProgressMs = serverReferenceAt > 0
        ? Math.max(0, serverReferenceAt - serverAnchorAt)
        : progressMs;
      normalized.anchorAt = receivedAt - Math.max(progressMs, serverProgressMs);
      normalized.anchor_at = normalized.anchorAt;
    } else {
      normalized.anchorAt = 0;
      normalized.anchor_at = 0;
    }

    if (serverQueueEndAt > 0 && serverReferenceAt > 0) {
      normalized.queueEndAt = receivedAt + Math.max(0, serverQueueEndAt - serverReferenceAt);
    } else {
      normalized.queueEndAt = serverQueueEndAt;
    }
    normalized.queue_end_at = normalized.queueEndAt;

    if (typeof queueStatus.playing === 'boolean') {
      const playing = queueStatus.playing && queueStatus.is_paused !== true;
      normalized.playing = playing;
      normalized.is_paused = !playing;
    } else if (typeof queueStatus.is_paused === 'boolean') {
      normalized.is_paused = queueStatus.is_paused;
      if (queueStatus.is_paused) normalized.playing = false;
    }
    if (queue.length) normalized.queue = queue.map(normalizeQueueItem);

    return normalized;
  }

  function responseFromPayload(payload) {
    return new Response(JSON.stringify(payload), {
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  }

  function rememberNativePlayback(message) {
    const source = message?.source === 'b' ? 'b' : message?.source === 'a' ? 'a' : '';
    if (!source) return;
    const fetchedAt = Number(message.fetchedAt || Date.now()) || Date.now();
    if (message.payload && typeof message.payload === 'object') {
      nativePlaybackPayloads.set(source, {
        payload: normalizePlaybackPayload(message.payload, fetchedAt),
        fetchedAt,
        error: '',
      });
      window.dispatchEvent(new Event('online'));
      return;
    }
    nativePlaybackPayloads.set(source, {
      payload: null,
      fetchedAt,
      error: String(message.error || 'native playback fetch failed'),
    });
  }

  window.__homepanelNormalizeStationheadPlayback = normalizePlaybackPayload;
  window.__homepanelNativePlaybackPayloads = nativePlaybackPayloads;
  window.chrome?.webview?.addEventListener('message', event => {
    if (event.data?.type === 'native-playback') rememberNativePlayback(event.data);
  });

  window.fetch = async function homePanelFetch(input, init) {
    const source = playbackSourceKey(input);
    if (source) {
      const cached = nativePlaybackPayloads.get(source);
      if (cached?.payload) return responseFromPayload(cached.payload);
    }

    const response = await originalFetch(input, init);
    if (!isPlaybackRequest(input) || !response.ok) return response;

    try {
      const payload = await response.clone().json();
      const normalized = normalizePlaybackPayload(payload, Date.now());
      const headers = new Headers(response.headers);
      headers.delete('content-encoding');
      headers.delete('content-length');
      headers.set('content-type', 'application/json; charset=utf-8');
      return new Response(JSON.stringify(normalized), {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    } catch (_) {
      return response;
    }
  };
})();
