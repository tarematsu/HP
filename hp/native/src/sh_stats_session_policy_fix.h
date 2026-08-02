#pragma once

namespace hp {

// Final Stationhead statistics policy. Authentication observation and statistics
// transport are deliberately generated here in one place so later policy layers
// cannot partially replace the request lifecycle.
inline std::wstring StationheadAuthCaptureScriptStatsSessionSafe() {
  std::wstring script = StationheadAuthCaptureScript();
  script.append(LR"JS(
(() => {
  const host = String(location.hostname || '').toLowerCase();
  if ((host !== 'stationhead.com' && !host.endsWith('.stationhead.com')) ||
      window.top !== window || window.__homepanelStationheadStatsSessionGuard) {
    return;
  }
  window.__homepanelStationheadStatsSessionGuard = true;

  const NativeURL = window.URL;
  const nativeTimeout = window.setTimeout.bind(window);
  const documentGeneration = (() => {
    const current = Number(
      window.__homepanelStationheadStatsDocumentGeneration || 0);
    if (Number.isSafeInteger(current) && current > 0) return current;
    const generated = Date.now() * 1000 + Math.floor(Math.random() * 1000);
    window.__homepanelStationheadStatsDocumentGeneration = generated;
    return generated;
  })();
  try {
    window.chrome?.webview?.postMessage({
      type: 'stationhead-stats-document',
      document_generation: documentGeneration,
    });
  } catch (_) {}

  let nextAuthorizationGeneration = 0;
  let acceptedAuthorizationGeneration = 0;
  const authorizationGenerations = new Map();
  let latestValidatedHeaders = null;
  let latestValidatedGeneration = 0;

  const requestInfo = value => {
    try {
      if (!NativeURL) return null;
      const parsed = new NativeURL(String(value || ''), location.href);
      const targetHost = String(parsed.hostname || '').toLowerCase();
      const stationhead = parsed.protocol === 'https:' &&
        (targetHost === 'stationhead.com' ||
         targetHost.endsWith('.stationhead.com'));
      if (!stationhead) return null;
      const path = String(parsed.pathname || '').toLowerCase();
      const accountScoped = targetHost === 'production1.stationhead.com' &&
        (path === '/me' || path.startsWith('/me/') ||
         path === '/account' || path.startsWith('/account/'));
      return { accountScoped };
    } catch (_) {
      return null;
    }
  };

  const observe = (url, headers) => {
    const info = requestInfo(url);
    const authorization = headers?.get?.('authorization') || '';
    if (!info || !authorization) return null;
    let generation = Number(authorizationGenerations.get(authorization) || 0);
    if (!generation) {
      generation = ++nextAuthorizationGeneration;
      authorizationGenerations.set(authorization, generation);
    }
    return {
      authorization,
      generation,
      accountScoped: info.accountScoped,
      headers: {
        authorization,
        'sth-device-uid': headers.get('sth-device-uid') || '',
        'app-platform': headers.get('app-platform') || 'web',
        'app-version': headers.get('app-version') || '1.0.0',
      },
    };
  };

  const sameAuthorization = (candidate, authorization) =>
    candidate?.authorization && candidate.authorization === authorization;
  const clearMatching = (name, authorization, generationName = '') => {
    const candidate = window[name];
    if (!sameAuthorization(candidate, authorization)) return;
    window[name] = null;
    if (generationName) window[generationName] = 0;
  };
  const cloneHeaders = headers => Object.assign({}, headers);

  const publishReadyIfChanged = (
      previousAuthorization, previousGeneration) => {
    const currentAuthorization =
      window.__homepanelStationheadAuthHeaders?.authorization || '';
    const currentGeneration = Number(
      window.__homepanelStationheadStatsAuthGeneration || 0);
    if (!currentAuthorization ||
        (currentAuthorization === previousAuthorization &&
         currentGeneration === previousGeneration)) {
      return;
    }
    try {
      window.dispatchEvent(new Event('homepanel-stationhead-auth-ready'));
    } catch (_) {}
    try {
      window.chrome?.webview?.postMessage({
        type: 'stationhead-auth-ready',
        auth_generation: currentGeneration,
      });
    } catch (_) {}
  };

  const restoreLatest = observation => {
    if (!latestValidatedHeaders?.authorization) return;
    const current = window.__homepanelStationheadAuthHeaders;
    if (!sameAuthorization(current, observation.authorization)) return;
    const previousAuthorization = current?.authorization || '';
    const previousGeneration = Number(
      window.__homepanelStationheadStatsAuthGeneration || 0);
    window.__homepanelStationheadAuthHeaders = cloneHeaders(latestValidatedHeaders);
    window.__homepanelStationheadLastAcceptedAuthHeaders =
      cloneHeaders(latestValidatedHeaders);
    window.__homepanelStationheadLatestValidatedAuthHeaders =
      cloneHeaders(latestValidatedHeaders);
    window.__homepanelStationheadStatsAuthGeneration = latestValidatedGeneration;
    window.__homepanelStationheadLastAcceptedAuthGeneration =
      latestValidatedGeneration;
    window.__homepanelStationheadLatestValidatedAuthGeneration =
      latestValidatedGeneration;
    publishReadyIfChanged(previousAuthorization, previousGeneration);
  };

  const rejectGlobally = observation => {
    const authorization = observation?.authorization || '';
    if (!authorization) return;
    clearMatching('__homepanelStationheadAuthHeaders', authorization);
    clearMatching(
      '__homepanelStationheadLastAcceptedAuthHeaders', authorization,
      '__homepanelStationheadLastAcceptedAuthGeneration');
    clearMatching(
      '__homepanelStationheadAccountAuthHeaders', authorization,
      '__homepanelStationheadAccountAuthGeneration');
    clearMatching(
      '__homepanelStationheadLatestValidatedAuthHeaders', authorization,
      '__homepanelStationheadLatestValidatedAuthGeneration');
    if (latestValidatedHeaders?.authorization === authorization) {
      latestValidatedHeaders = null;
      latestValidatedGeneration = 0;
    }
    window.__homepanelStationheadStatsAuthGeneration = 0;
    try { window.__homepanelStationheadPlayStatsAbort?.abort(); } catch (_) {}
    window.__homepanelStationheadPlayStatsInFlight = false;
    window.__homepanelStationheadRejectedAuthorization = authorization;
    window.__homepanelStationheadStatsRejectedAuthorization = authorization;
    window.__homepanelStationheadStatsRejectedAt = Date.now();
  };

  const rejectForStats = observation => {
    const authorization = observation?.authorization || '';
    if (!authorization) return;
    clearMatching(
      '__homepanelStationheadAccountAuthHeaders', authorization,
      '__homepanelStationheadAccountAuthGeneration');
    window.__homepanelStationheadStatsRejectedAuthorization = authorization;
    window.__homepanelStationheadStatsRejectedAt = Date.now();
    restoreLatest(observation);
  };

  const accept = observation => {
    if (!observation?.authorization) return;
    if (observation.generation < acceptedAuthorizationGeneration) {
      restoreLatest(observation);
      return;
    }
    const previousAuthorization =
      window.__homepanelStationheadAuthHeaders?.authorization || '';
    const previousGeneration = Number(
      window.__homepanelStationheadStatsAuthGeneration || 0);
    acceptedAuthorizationGeneration = Math.max(
      acceptedAuthorizationGeneration, observation.generation);
    latestValidatedHeaders = cloneHeaders(observation.headers);
    latestValidatedGeneration = observation.generation;
    window.__homepanelStationheadRejectedAuthorization = null;
    if (window.__homepanelStationheadStatsRejectedAuthorization ===
        observation.authorization) {
      window.__homepanelStationheadStatsRejectedAuthorization = null;
      window.__homepanelStationheadStatsRejectedAt = 0;
    }
    window.__homepanelStationheadAuthHeaders = cloneHeaders(observation.headers);
    window.__homepanelStationheadLastAcceptedAuthHeaders =
      cloneHeaders(observation.headers);
    window.__homepanelStationheadLatestValidatedAuthHeaders =
      cloneHeaders(observation.headers);
    window.__homepanelStationheadStatsAuthGeneration = observation.generation;
    window.__homepanelStationheadLastAcceptedAuthGeneration =
      observation.generation;
    window.__homepanelStationheadLatestValidatedAuthGeneration =
      observation.generation;
    if (observation.accountScoped) {
      window.__homepanelStationheadAccountAuthHeaders =
        cloneHeaders(observation.headers);
      window.__homepanelStationheadAccountAuthGeneration =
        observation.generation;
    }
    if (previousAuthorization &&
        previousAuthorization !== observation.authorization) {
      try { window.__homepanelStationheadPlayStatsAbort?.abort(); } catch (_) {}
      window.__homepanelStationheadPlayStatsInFlight = false;
    }
    publishReadyIfChanged(previousAuthorization, previousGeneration);
  };

  const settle = (observation, statusValue) => {
    if (!observation) return;
    const status = Number(statusValue || 0);
    if (status === 401) {
      rejectGlobally(observation);
      return;
    }
    if (status === 403 && observation.accountScoped) {
      rejectForStats(observation);
      return;
    }
    if (status >= 200 && status < 400) {
      accept(observation);
      return;
    }
    restoreLatest(observation);
  };

  const currentFetch = window.fetch ? window.fetch.bind(window) : null;
  if (currentFetch) {
    window.fetch = function(input, init) {
      let observation = null;
      try {
        const headers = new Headers((input && input.headers) || {});
        if (init && init.headers) {
          const initHeaders = new Headers(init.headers);
          initHeaders.forEach((value, name) => headers.set(name, value));
        }
        const url = typeof input === 'string' ? input :
          (NativeURL && input instanceof NativeURL ? input.href :
            (input && input.url) || '');
        observation = observe(url, headers);
      } catch (_) {}
      const result = currentFetch(input, init);
      if (observation && typeof result?.then === 'function') {
        result.then(
          response => settle(observation, response?.status),
          () => restoreLatest(observation));
      }
      return result;
    };
  }

  const NativeXhr = window.XMLHttpRequest;
  if (NativeXhr) {
    const currentSend = NativeXhr.prototype.send;
    NativeXhr.prototype.send = function(...args) {
      let observation = null;
      try {
        observation = observe(
          this.__homepanelUrl,
          new Headers(this.__homepanelHeaders || {}));
      } catch (_) {}
      const result = currentSend.apply(this, args);
      if (observation) {
        this.addEventListener('loadend', () => {
          nativeTimeout(() => settle(observation, this.status), 0);
        }, { once: true });
      }
      return result;
    };
  }
})()
)JS");
  return script;
}

inline std::wstring StationheadApiPlayStatsScriptStatsSessionSafe(int channelId) {
  std::wostringstream script;
  script << LR"JS(
(() => {
  const post = message => {
    try { window.chrome?.webview?.postMessage(message); } catch (_) {}
  };
  const nativeTimeout = window.setTimeout.bind(window);
  const nativeClearTimeout = window.clearTimeout.bind(window);
  const channelId = )JS" << channelId << LR"JS(;
  const documentGeneration = (() => {
    const current = Number(
      window.__homepanelStationheadStatsDocumentGeneration || 0);
    if (Number.isSafeInteger(current) && current > 0) return current;
    const generated = Date.now() * 1000 + Math.floor(Math.random() * 1000);
    window.__homepanelStationheadStatsDocumentGeneration = generated;
    return generated;
  })();
  const requestId = Number(
    window.__homepanelStationheadPlayStatsNextRequestId || 0) + 1;
  window.__homepanelStationheadPlayStatsNextRequestId = requestId;
  window.__homepanelStationheadStatsDocumentActive = true;

  if (!window.__homepanelStationheadStatsPageHideInstalled) {
    window.__homepanelStationheadStatsPageHideInstalled = true;
    window.addEventListener('pagehide', () => {
      window.__homepanelStationheadStatsDocumentActive = false;
      try { window.__homepanelStationheadPlayStatsAbort?.abort(); } catch (_) {}
      window.__homepanelStationheadPlayStatsAbort = null;
      window.__homepanelStationheadPlayStatsInFlight = false;
    }, { once: true });
  }

  const resetSuccessThrottle = () => {
    window.__homepanelStationheadPlayStatsSuccessAt = 0;
    window.__homepanelStationheadPlayStatsAuthorization = '';
  };
  const clearRetry = () => {
    const timer = window.__homepanelStationheadPlayStatsRetryTimer;
    if (!timer) return;
    nativeClearTimeout(timer);
    window.__homepanelStationheadPlayStatsRetryTimer = 0;
  };
  const scheduleRetry = (error, status = 0) => {
    resetSuccessThrottle();
    post({
      type: 'stationhead-play-stats-error',
      error,
      status,
      request_id: requestId,
      document_generation: documentGeneration,
      auth_generation: Number(
        window.__homepanelStationheadStatsAuthGeneration || 0),
    });
    if (window.__homepanelStationheadPlayStatsRetryTimer) return;
    window.__homepanelStationheadPlayStatsRetryTimer = nativeTimeout(() => {
      window.__homepanelStationheadPlayStatsRetryTimer = 0;
      post({
        type: 'stationhead-auth-ready',
        reason: 'stats-retry',
        auth_generation: Number(
          window.__homepanelStationheadStatsAuthGeneration || 0),
      });
    }, 30 * 1000);
  };

  const now = Date.now();
  const globallyRejected = String(
    window.__homepanelStationheadRejectedAuthorization || '');
  const statsRejected = String(
    window.__homepanelStationheadStatsRejectedAuthorization || '');
  const statsRejectedAt = Number(
    window.__homepanelStationheadStatsRejectedAt || 0);
  const statsCooldownActive = authorization =>
    authorization && authorization === statsRejected &&
    statsRejectedAt > 0 && now - statsRejectedAt < 30 * 1000;
  const usable = candidate => {
    const authorization = String(candidate?.authorization || '');
    return Boolean(authorization) && authorization !== globallyRejected &&
      !statsCooldownActive(authorization);
  };

  if (window.__homepanelStationheadBlockingLoginVisible === true) {
    scheduleRetry('blocking-login');
    return false;
  }

  const accountHeaders = window.__homepanelStationheadAccountAuthHeaders;
  const currentHeaders = window.__homepanelStationheadAuthHeaders;
  const latestHeaders = window.__homepanelStationheadLatestValidatedAuthHeaders;
  const acceptedHeaders = window.__homepanelStationheadLastAcceptedAuthHeaders;
  const candidates = [
    {
      headers: accountHeaders,
      generation: Number(
        window.__homepanelStationheadAccountAuthGeneration ||
          window.__homepanelStationheadStatsAuthGeneration || 0),
    },
    {
      headers: currentHeaders,
      generation: Number(
        window.__homepanelStationheadStatsAuthGeneration || 0),
    },
    {
      headers: latestHeaders,
      generation: Number(
        window.__homepanelStationheadLatestValidatedAuthGeneration ||
          window.__homepanelStationheadStatsAuthGeneration || 0),
    },
    {
      headers: acceptedHeaders,
      generation: Number(
        window.__homepanelStationheadLastAcceptedAuthGeneration ||
          window.__homepanelStationheadStatsAuthGeneration || 0),
    },
  ];
  const currentGeneration = Number(
    window.__homepanelStationheadStatsAuthGeneration || 0);
  const usableCandidates = candidates.filter(candidate =>
    usable(candidate.headers) &&
    Number.isSafeInteger(candidate.generation) && candidate.generation > 0 &&
    (!Number.isSafeInteger(currentGeneration) || currentGeneration <= 0 ||
      candidate.generation >= currentGeneration));
  const newestGeneration = usableCandidates.reduce(
    (latest, candidate) => Math.max(latest, candidate.generation), 0);
  const selected = usableCandidates.find(candidate =>
    candidate.generation === newestGeneration) || null;
  const headers = selected?.headers || null;
  const authGeneration = Number(selected?.generation || 0);
  if (!headers?.authorization) {
    scheduleRetry('no-auth-header');
    return false;
  }
  if (!Number.isSafeInteger(authGeneration) || authGeneration <= 0) {
    scheduleRetry('no-validated-auth');
    return false;
  }

  const lastSuccessAt = Number(
    window.__homepanelStationheadPlayStatsSuccessAt || 0);
  const lastSuccessAuthorization = String(
    window.__homepanelStationheadPlayStatsAuthorization || '');
  if (lastSuccessAt > 0 &&
      lastSuccessAuthorization === headers.authorization &&
      now - lastSuccessAt < 5 * 60 * 1000) {
    return false;
  }
  if (window.__homepanelStationheadPlayStatsInFlight) return false;
  window.__homepanelStationheadPlayStatsLatestRequestId = requestId;
  window.__homepanelStationheadPlayStatsInFlight = true;

  try { window.__homepanelStationheadPlayStatsAbort?.abort(); } catch (_) {}
  const abortController = typeof AbortController === 'function'
    ? new AbortController() : null;
  window.__homepanelStationheadPlayStatsAbort = abortController;
  const requestTimeoutTimer = abortController
    ? nativeTimeout(() => {
        if (window.__homepanelStationheadPlayStatsLatestRequestId === requestId) {
          window.__homepanelStationheadPlayStatsTimedOutRequestId = requestId;
          abortController.abort();
        }
      }, 20 * 1000)
    : 0;

  const clearMatching = name => {
    if (window[name]?.authorization === headers.authorization) window[name] = null;
  };
  const reject = status => {
    resetSuccessThrottle();
    if (status === 401) {
      clearMatching('__homepanelStationheadAuthHeaders');
      clearMatching('__homepanelStationheadLastAcceptedAuthHeaders');
      clearMatching('__homepanelStationheadLatestValidatedAuthHeaders');
      window.__homepanelStationheadLastAcceptedAuthGeneration = 0;
      window.__homepanelStationheadLatestValidatedAuthGeneration = 0;
      window.__homepanelStationheadRejectedAuthorization = headers.authorization;
    }
    clearMatching('__homepanelStationheadAccountAuthHeaders');
    window.__homepanelStationheadAccountAuthGeneration = 0;
    window.__homepanelStationheadStatsRejectedAuthorization =
      headers.authorization;
    window.__homepanelStationheadStatsRejectedAt = Date.now();
    post({
      type: 'stationhead-play-stats-auth-failed',
      status,
      request_id: requestId,
      document_generation: documentGeneration,
      auth_generation: authGeneration,
    });
  };

  const numberValue = value => {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value !== 'string') return null;
    const normalized = value.replace(/,/g, '').trim();
    if (!normalized) return null;
    const numeric = Number(normalized);
    return Number.isFinite(numeric) ? numeric : null;
  };
  const timestampValue = value => {
    let numeric = numberValue(value);
    if (numeric === null && typeof value === 'string') {
      const parsed = Date.parse(value);
      if (Number.isFinite(parsed)) numeric = parsed;
    }
    if (!Number.isFinite(numeric) || numeric <= 0) return null;
    if (numeric < 100000000000) numeric *= 1000;
    else if (numeric > 100000000000000) numeric /= 1000;
    return Math.round(numeric);
  };
  const normalizePoint = point => {
    if (Array.isArray(point) && point.length >= 2) {
      point = { ts: point[0], val: point[1] };
    }
    if (!point || typeof point !== 'object') return null;
    const ts = timestampValue(
      point.ts ?? point.timestamp ?? point.date ?? point.day ?? point.x);
    const val = numberValue(
      point.val ?? point.value ?? point.count ?? point.plays ??
      point.listens ?? point.y);
    if (!Number.isFinite(ts) || !Number.isFinite(val) || val < 0 ||
        val > 2147483647) {
      return null;
    }
    return { ts, val: Math.round(val) };
  };
  const chartCandidates = payload => {
    const candidates = [];
    const containers = [
      payload,
      payload?.data,
      payload?.result,
      payload?.stats,
      payload?.payload,
      payload?.data?.stats,
      payload?.data?.result,
    ];
    for (const container of containers) {
      if (Array.isArray(container)) {
        candidates.push(container);
        continue;
      }
      if (!container || typeof container !== 'object') continue;
      for (const key of [
        'chart_data', 'chartData', 'daily', 'history', 'points', 'values',
      ]) {
        const candidate = container[key];
        if (Array.isArray(candidate)) candidates.push(candidate);
        else if (candidate && typeof candidate === 'object') {
          candidates.push(
            Object.entries(candidate).map(([date, value]) => ({ date, value })));
        }
      }
    }
    return candidates;
  };
  const normalizedChart = (payload, referenceTime) => {
    const maximumFuture = referenceTime + 2 * 24 * 60 * 60 * 1000;
    const minimumPast = referenceTime - 60 * 24 * 60 * 60 * 1000;
    const charts = chartCandidates(payload)
      .map(candidate => candidate.map(normalizePoint).filter(point =>
        point && point.ts >= minimumPast && point.ts <= maximumFuture))
      .filter(candidate => candidate.length > 0);
    if (!charts.length) return [];
    const positiveCount = points => points.reduce(
      (count, point) => count + (point.val > 0 ? 1 : 0), 0);
    const latestTimestamp = points => points.reduce(
      (latest, point) => Math.max(latest, point.ts), 0);
    charts.sort((left, right) =>
      positiveCount(right) - positiveCount(left) ||
      right.length - left.length ||
      latestTimestamp(right) - latestTimestamp(left));
    const byTimestamp = new Map();
    for (const point of charts[0]) byTimestamp.set(point.ts, point);
    return Array.from(byTimestamp.values())
      .sort((left, right) => left.ts - right.ts)
      .slice(-45);
  };

  const stillCurrent = () =>
    window.__homepanelStationheadStatsDocumentActive === true &&
    window.__homepanelStationheadStatsDocumentGeneration ===
      documentGeneration &&
    window.__homepanelStationheadPlayStatsLatestRequestId === requestId &&
    Number(window.__homepanelStationheadStatsAuthGeneration || 0) ===
      authGeneration;

  const requestHeaders = {
    accept: 'application/json',
    authorization: headers.authorization,
    'sth-device-uid': headers['sth-device-uid'] || '',
    'app-platform': headers['app-platform'] || 'web',
    'app-version': headers['app-version'] || '1.0.0',
  };
  const url = 'https://production1.stationhead.com/me/channel/' +
    channelId + '/streakStats';
  fetch(url, {
    method: 'GET',
    credentials: 'include',
    cache: 'no-store',
    signal: abortController?.signal,
    headers: requestHeaders,
  }).then(async response => {
    if (!stillCurrent()) return null;
    if (response.status === 401 || response.status === 403) {
      reject(response.status);
      return null;
    }
    if (!response.ok) {
      scheduleRetry('http-' + response.status, response.status);
      return null;
    }
    const serverDate = Date.parse(response.headers?.get?.('date') || '');
    const data = await response.json();
    return {
      data,
      serverDateMs: Number.isFinite(serverDate) ? serverDate : 0,
    };
  }).then(result => {
    if (!result || !stillCurrent()) return;
    const referenceTime = result.serverDateMs > 0
      ? result.serverDateMs : Date.now();
    const chartData = normalizedChart(result.data, referenceTime);
    if (!chartData.length) {
      scheduleRetry('invalid-payload');
      return;
    }

    clearRetry();
    const updatedAt = Date.now();
    const timezone = typeof result.data?.timezone === 'string'
      ? result.data.timezone : '';
    window.__homepanelStationheadStatsRejectedAuthorization = null;
    window.__homepanelStationheadStatsRejectedAt = 0;
    window.__homepanelStationheadAccountAuthHeaders = Object.assign({}, headers);
    window.__homepanelStationheadAccountAuthGeneration = authGeneration;
    window.__homepanelStationheadPlayStatsSuccessAt = updatedAt;
    window.__homepanelStationheadPlayStatsAuthorization = headers.authorization;
    post({
      type: 'stationhead-play-stats',
      data: { chart_data: chartData },
      source: 'authenticated-api-normalized-v3',
      request_id: requestId,
      document_generation: documentGeneration,
      auth_generation: authGeneration,
      server_date_ms: result.serverDateMs,
      timezone,
    });
  }).catch(error => {
    if (!stillCurrent()) return;
    if (error?.name === 'AbortError') {
      if (window.__homepanelStationheadPlayStatsTimedOutRequestId === requestId) {
        scheduleRetry('request-timeout');
      }
      return;
    }
    scheduleRetry('network-or-json');
  }).finally(() => {
    if (requestTimeoutTimer) nativeClearTimeout(requestTimeoutTimer);
    if (window.__homepanelStationheadPlayStatsTimedOutRequestId === requestId) {
      window.__homepanelStationheadPlayStatsTimedOutRequestId = 0;
    }
    if (window.__homepanelStationheadPlayStatsLatestRequestId === requestId) {
      window.__homepanelStationheadPlayStatsInFlight = false;
      if (window.__homepanelStationheadPlayStatsAbort === abortController) {
        window.__homepanelStationheadPlayStatsAbort = null;
      }
    }
  });
  return true;
})()
)JS";
  return script.str();
}

}  // namespace hp

#undef StationheadAuthCaptureScript
#define StationheadAuthCaptureScript \
  StationheadAuthCaptureScriptStatsSessionSafe
#undef StationheadApiPlayStatsScript
#define StationheadApiPlayStatsScript \
  StationheadApiPlayStatsScriptStatsSessionSafe
