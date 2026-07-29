#pragma once

namespace hp {

// Keep an independent, account-aware validation layer outside the historical
// capture wrappers. The older response-validation policy can temporarily promote
// any non-401 response and its rotation order is request-based. Stationhead can
// send an older bearer again after a newer account bearer, so request order is
// not a safe proxy for credential generation.
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
  let nextAuthorizationGeneration = 0;
  let acceptedAuthorizationGeneration = 0;
  const authorizationGenerations = new Map();
  let latestValidatedHeaders = null;

  const requestInfo = value => {
    try {
      if (!NativeURL) return null;
      const parsed = new NativeURL(String(value || ''), location.href);
      const targetHost = String(parsed.hostname || '').toLowerCase();
      const stationhead = parsed.protocol === 'https:' &&
        (targetHost === 'stationhead.com' || targetHost.endsWith('.stationhead.com'));
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

  const clearMatching = (name, authorization) => {
    const candidate = window[name];
    if (sameAuthorization(candidate, authorization)) window[name] = null;
  };

  const publishReadyIfChanged = previousAuthorization => {
    const currentAuthorization =
      window.__homepanelStationheadAuthHeaders?.authorization || '';
    if (!currentAuthorization || currentAuthorization === previousAuthorization) return;
    try { window.dispatchEvent(new Event('homepanel-stationhead-auth-ready')); } catch (_) {}
    try {
      window.chrome?.webview?.postMessage({ type: 'stationhead-auth-ready' });
    } catch (_) {}
  };

  const restoreLatest = observation => {
    if (!latestValidatedHeaders?.authorization) return;
    const current = window.__homepanelStationheadAuthHeaders;
    if (!sameAuthorization(current, observation.authorization)) return;
    const previousAuthorization = current?.authorization || '';
    window.__homepanelStationheadAuthHeaders =
      Object.assign({}, latestValidatedHeaders);
    window.__homepanelStationheadLastAcceptedAuthHeaders =
      Object.assign({}, latestValidatedHeaders);
    publishReadyIfChanged(previousAuthorization);
  };

  const rejectGlobally = observation => {
    const authorization = observation?.authorization || '';
    if (!authorization) return;
    clearMatching('__homepanelStationheadAuthHeaders', authorization);
    clearMatching('__homepanelStationheadLastAcceptedAuthHeaders', authorization);
    clearMatching('__homepanelStationheadAccountAuthHeaders', authorization);
    clearMatching('__homepanelStationheadLatestValidatedAuthHeaders', authorization);
    if (latestValidatedHeaders?.authorization === authorization) {
      latestValidatedHeaders = null;
    }
    window.__homepanelStationheadRejectedAuthorization = authorization;
    window.__homepanelStationheadStatsRejectedAuthorization = authorization;
    window.__homepanelStationheadStatsRejectedAt = Date.now();
  };

  const rejectForStats = observation => {
    const authorization = observation?.authorization || '';
    if (!authorization) return;
    clearMatching('__homepanelStationheadAccountAuthHeaders', authorization);
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
    acceptedAuthorizationGeneration = Math.max(
      acceptedAuthorizationGeneration, observation.generation);
    latestValidatedHeaders = Object.assign({}, observation.headers);
    window.__homepanelStationheadRejectedAuthorization = null;
    if (window.__homepanelStationheadStatsRejectedAuthorization ===
        observation.authorization) {
      window.__homepanelStationheadStatsRejectedAuthorization = null;
      window.__homepanelStationheadStatsRejectedAt = 0;
    }
    window.__homepanelStationheadAuthHeaders =
      Object.assign({}, observation.headers);
    window.__homepanelStationheadLastAcceptedAuthHeaders =
      Object.assign({}, observation.headers);
    window.__homepanelStationheadLatestValidatedAuthHeaders =
      Object.assign({}, observation.headers);
    if (observation.accountScoped) {
      window.__homepanelStationheadAccountAuthHeaders =
        Object.assign({}, observation.headers);
    }
    publishReadyIfChanged(previousAuthorization);
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
    // Network/status-0 and 4xx/5xx responses do not validate a credential. Undo
    // an optimistic promotion made by an inner legacy wrapper when possible.
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
          // Inner response-validation listeners were registered during send().
          // Run after them so an unsafe optimistic promotion is corrected last.
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

// Generate the statistics request directly rather than layering another fragile
// text replacement over the historical generator. Prefer an account-scoped
// bearer, never reuse a currently rejected bearer, and normalize the small set
// of response shapes used by Stationhead deployments into {chart_data:[{ts,val}]}.
inline std::wstring StationheadApiPlayStatsScriptStatsSessionSafe(int channelId) {
  std::wostringstream script;
  script << LR"JS(
(() => {
  const post = message => {
    try { window.chrome?.webview?.postMessage(message); } catch (_) {}
  };
  const resetSuccessThrottle = () => {
    window.__homepanelStationheadPlayStatsSuccessAt = 0;
    window.__homepanelStationheadPlayStatsAuthorization = '';
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
    resetSuccessThrottle();
    post({ type: 'stationhead-play-stats-error', error: 'blocking-login' });
    return false;
  }
  const accountHeaders = window.__homepanelStationheadAccountAuthHeaders;
  const currentHeaders = window.__homepanelStationheadAuthHeaders;
  const acceptedHeaders = window.__homepanelStationheadLastAcceptedAuthHeaders;
  const latestHeaders = window.__homepanelStationheadLatestValidatedAuthHeaders;
  const headers = usable(accountHeaders) ? accountHeaders :
    (usable(currentHeaders) ? currentHeaders :
      (usable(latestHeaders) ? latestHeaders :
        (usable(acceptedHeaders) ? acceptedHeaders : null)));
  if (!headers?.authorization) {
    resetSuccessThrottle();
    post({ type: 'stationhead-play-stats-error', error: 'no-auth-header' });
    return false;
  }
  const lastSuccessAt = Number(
    window.__homepanelStationheadPlayStatsSuccessAt || 0);
  const lastSuccessAuthorization = String(
    window.__homepanelStationheadPlayStatsAuthorization || '');
  if (lastSuccessAt > 0 &&
      lastSuccessAuthorization === headers.authorization &&
      now - lastSuccessAt < 10 * 60 * 1000) {
    return false;
  }
  if (window.__homepanelStationheadPlayStatsInFlight) return false;
  window.__homepanelStationheadPlayStatsInFlight = true;

  const clearMatching = name => {
    if (window[name]?.authorization === headers.authorization) window[name] = null;
  };
  const reject = status => {
    resetSuccessThrottle();
    if (status === 401) {
      clearMatching('__homepanelStationheadAuthHeaders');
      clearMatching('__homepanelStationheadLastAcceptedAuthHeaders');
      clearMatching('__homepanelStationheadLatestValidatedAuthHeaders');
      window.__homepanelStationheadRejectedAuthorization = headers.authorization;
    }
    clearMatching('__homepanelStationheadAccountAuthHeaders');
    window.__homepanelStationheadStatsRejectedAuthorization =
      headers.authorization;
    window.__homepanelStationheadStatsRejectedAt = Date.now();
    post({ type: 'stationhead-play-stats-auth-failed', status });
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
    if (numeric < 100000000000) numeric *= 1000;       // Unix seconds.
    else if (numeric > 100000000000000) numeric /= 1000; // Unix microseconds.
    return Math.round(numeric);
  };
  const objectKeys = value => value && typeof value === 'object' && !Array.isArray(value)
    ? Object.keys(value).slice(0, 16) : [];
  const chartFrom = payload => {
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
      if (Array.isArray(container)) return container;
      if (!container || typeof container !== 'object') continue;
      for (const key of [
        'chart_data', 'chartData', 'daily', 'history', 'points', 'values',
      ]) {
        const candidate = container[key];
        if (Array.isArray(candidate)) return candidate;
        if (candidate && typeof candidate === 'object') {
          return Object.entries(candidate).map(([date, value]) => ({ date, value }));
        }
      }
    }
    return null;
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
    if (!Number.isFinite(ts) || !Number.isFinite(val) || val < 0) return null;
    return { ts, val: Math.round(val) };
  };

  const url = 'https://production1.stationhead.com/me/channel/)JS"
         << channelId << LR"JS(/streakStats';
  fetch(url, {
    method: 'GET',
    credentials: 'include',
    cache: 'no-store',
    headers: Object.assign({ accept: 'application/json' }, headers),
  }).then(async response => {
    if (response.status === 401 || response.status === 403) {
      reject(response.status);
      return null;
    }
    if (!response.ok) throw new Error('http-' + response.status);
    return response.json();
  }).then(data => {
    if (!data) return;
    const rawChart = chartFrom(data);
    const chartData = Array.isArray(rawChart)
      ? rawChart.map(normalizePoint).filter(Boolean).slice(-40)
      : [];
    if (!chartData.length) {
      resetSuccessThrottle();
      post({
        type: 'stationhead-play-stats-error',
        error: 'invalid-payload',
        keys: objectKeys(data),
        dataKeys: objectKeys(data?.data),
      });
      return;
    }
    window.__homepanelStationheadStatsRejectedAuthorization = null;
    window.__homepanelStationheadStatsRejectedAt = 0;
    window.__homepanelStationheadAccountAuthHeaders = Object.assign({}, headers);
    window.__homepanelStationheadPlayStatsSuccessAt = Date.now();
    window.__homepanelStationheadPlayStatsAuthorization = headers.authorization;
    post({
      type: 'stationhead-play-stats',
      data: { chart_data: chartData },
      source: 'authenticated-api-normalized',
    });
  }).catch(error => {
    resetSuccessThrottle();
    post({
      type: 'stationhead-play-stats-error',
      error: String(error?.message || error),
    });
  }).finally(() => {
    window.__homepanelStationheadPlayStatsInFlight = false;
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
