#pragma once

namespace hp {

// Final play-count policy. Keep Stationhead's existing page-owned Authorization
// capture, then add only the small native bridge needed by the Music panel.
// A document has one generation, one in-flight request, and one monotonically
// increasing request id. The native reducer can therefore reject old documents
// without coupling a valid response to several independently rotating auth ids.
inline std::wstring StationheadAuthCaptureScriptStatsSessionSafe() {
  std::wstring script = StationheadAuthCaptureScript();
  script.append(LR"JS(
(() => {
  const host = String(location.hostname || '').toLowerCase();
  if ((host !== 'stationhead.com' && !host.endsWith('.stationhead.com')) ||
      window.top !== window || window.__homepanelPlayCountBridge) {
    return;
  }
  window.__homepanelPlayCountBridge = true;

  const post = message => {
    try { window.chrome?.webview?.postMessage(message); } catch (_) {}
  };
  const safePositiveInteger = value =>
    Number.isSafeInteger(Number(value)) && Number(value) > 0
      ? Number(value) : 0;
  const documentGeneration = (() => {
    const current = safePositiveInteger(
      window.__homepanelStationheadStatsDocumentGeneration);
    if (current) return current;
    const generated = Date.now() * 1000 + Math.floor(Math.random() * 1000);
    window.__homepanelStationheadStatsDocumentGeneration = generated;
    return generated;
  })();

  const publishDocument = () => post({
    type: 'stationhead-stats-document',
    document_generation: documentGeneration,
  });
  const publishReady = () => {
    const headers = window.__homepanelStationheadAuthHeaders;
    if (!headers?.authorization) return false;
    let generation = safePositiveInteger(
      window.__homepanelStationheadStatsAuthGeneration);
    if (!generation) {
      generation = 1;
      window.__homepanelStationheadStatsAuthGeneration = generation;
    }
    post({
      type: 'stationhead-auth-ready',
      auth_generation: generation,
    });
    return true;
  };

  publishDocument();
  window.addEventListener('homepanel-stationhead-auth-ready', publishReady);
  window.setTimeout(publishReady, 0);
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
  const channelId = )JS";
  script << channelId;
  script << LR"JS(;
  const safePositiveInteger = value =>
    Number.isSafeInteger(Number(value)) && Number(value) > 0
      ? Number(value) : 0;
  const documentGeneration = (() => {
    const current = safePositiveInteger(
      window.__homepanelStationheadStatsDocumentGeneration);
    if (current) return current;
    const generated = Date.now() * 1000 + Math.floor(Math.random() * 1000);
    window.__homepanelStationheadStatsDocumentGeneration = generated;
    return generated;
  })();

  // Re-publish the current document before every poll. WebView2 preserves
  // message order, while the network result is asynchronous, so native always
  // knows the active document before it receives the matching snapshot.
  post({
    type: 'stationhead-stats-document',
    document_generation: documentGeneration,
  });

  if (window.__homepanelStationheadBlockingLoginVisible === true) {
    post({ type: 'stationhead-play-stats-error', error: 'blocking-login' });
    return false;
  }

  const candidates = [
    {
      headers: window.__homepanelStationheadAccountAuthHeaders,
      generation: window.__homepanelStationheadAccountAuthGeneration,
    },
    {
      headers: window.__homepanelStationheadAuthHeaders,
      generation: window.__homepanelStationheadStatsAuthGeneration,
    },
    {
      headers: window.__homepanelStationheadLatestValidatedAuthHeaders,
      generation: window.__homepanelStationheadLatestValidatedAuthGeneration,
    },
    {
      headers: window.__homepanelStationheadLastAcceptedAuthHeaders,
      generation: window.__homepanelStationheadLastAcceptedAuthGeneration,
    },
  ];
  const rejected = String(
    window.__homepanelStationheadRejectedAuthorization || '');
  const selected = candidates.find(candidate => {
    const authorization = String(candidate?.headers?.authorization || '');
    return authorization && authorization !== rejected;
  }) || null;
  const headers = selected?.headers || null;
  if (!headers?.authorization) {
    post({
      type: 'stationhead-play-stats-error',
      error: 'no-auth-header',
      document_generation: documentGeneration,
    });
    return false;
  }

  let authGeneration = safePositiveInteger(selected?.generation);
  if (!authGeneration) {
    authGeneration = safePositiveInteger(
      window.__homepanelStationheadStatsAuthGeneration) || 1;
  }
  window.__homepanelStationheadStatsAuthGeneration = authGeneration;
  post({
    type: 'stationhead-auth-ready',
    auth_generation: authGeneration,
  });

  const now = Date.now();
  const lastSuccessAt = Number(
    window.__homepanelStationheadPlayStatsSuccessAt || 0);
  const lastAuthorization = String(
    window.__homepanelStationheadPlayStatsAuthorization || '');
  if (lastSuccessAt > 0 && lastAuthorization === headers.authorization &&
      now - lastSuccessAt < 5 * 60 * 1000) {
    return false;
  }
  if (window.__homepanelStationheadPlayStatsInFlight) return false;

  const requestId = safePositiveInteger(
    window.__homepanelStationheadPlayStatsNextRequestId) + 1;
  window.__homepanelStationheadPlayStatsNextRequestId = requestId;
  window.__homepanelStationheadPlayStatsLatestRequestId = requestId;
  window.__homepanelStationheadPlayStatsInFlight = true;
  window.__homepanelStationheadStatsDocumentActive = true;

  if (!window.__homepanelStationheadStatsPageHideInstalled) {
    window.__homepanelStationheadStatsPageHideInstalled = true;
    window.addEventListener('pagehide', () => {
      window.__homepanelStationheadStatsDocumentActive = false;
      try { window.__homepanelStationheadPlayStatsAbort?.abort(); } catch (_) {}
      window.__homepanelStationheadPlayStatsAbort = null;
      window.__homepanelStationheadPlayStatsInFlight = false;
    });
  }

  const clearRetry = () => {
    const timer = window.__homepanelStationheadPlayStatsRetryTimer;
    if (!timer) return;
    nativeClearTimeout(timer);
    window.__homepanelStationheadPlayStatsRetryTimer = 0;
  };
  const scheduleRetry = (error, status = 0) => {
    window.__homepanelStationheadPlayStatsSuccessAt = 0;
    window.__homepanelStationheadPlayStatsAuthorization = '';
    post({
      type: 'stationhead-play-stats-error',
      error,
      status,
      request_id: requestId,
      document_generation: documentGeneration,
      auth_generation: authGeneration,
    });
    if (window.__homepanelStationheadPlayStatsRetryTimer) return;
    window.__homepanelStationheadPlayStatsRetryTimer = nativeTimeout(() => {
      window.__homepanelStationheadPlayStatsRetryTimer = 0;
      post({
        type: 'stationhead-auth-ready',
        reason: 'stats-retry',
        auth_generation: authGeneration,
      });
    }, 30 * 1000);
  };

  try { window.__homepanelStationheadPlayStatsAbort?.abort(); } catch (_) {}
  const abortController = typeof AbortController === 'function'
    ? new AbortController() : null;
  window.__homepanelStationheadPlayStatsAbort = abortController;
  const timeoutTimer = abortController
    ? nativeTimeout(() => {
        if (window.__homepanelStationheadPlayStatsLatestRequestId === requestId) {
          window.__homepanelStationheadPlayStatsTimedOutRequestId = requestId;
          abortController.abort();
        }
      }, 20 * 1000)
    : 0;

  const numberValue = value => {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value !== 'string') return null;
    const numeric = Number(value.replace(/,/g, '').trim());
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
    const output = [];
    const containers = [
      payload, payload?.data, payload?.result, payload?.stats,
      payload?.payload, payload?.data?.stats, payload?.data?.result,
    ];
    for (const container of containers) {
      if (Array.isArray(container)) {
        output.push(container);
        continue;
      }
      if (!container || typeof container !== 'object') continue;
      for (const key of [
        'chart_data', 'chartData', 'daily', 'history', 'points', 'values',
      ]) {
        const candidate = container[key];
        if (Array.isArray(candidate)) output.push(candidate);
        else if (candidate && typeof candidate === 'object') {
          output.push(Object.entries(candidate).map(
            ([date, value]) => ({ date, value })));
        }
      }
    }
    return output;
  };
  const normalizedChart = (payload, referenceTime) => {
    const minimum = referenceTime - 60 * 24 * 60 * 60 * 1000;
    const maximum = referenceTime + 2 * 24 * 60 * 60 * 1000;
    const candidates = chartCandidates(payload)
      .map(candidate => candidate.map(normalizePoint).filter(point =>
        point && point.ts >= minimum && point.ts <= maximum))
      .filter(candidate => candidate.length > 0);
    if (!candidates.length) return [];
    const positiveCount = points => points.reduce(
      (count, point) => count + (point.val > 0 ? 1 : 0), 0);
    const latest = points => points.reduce(
      (value, point) => Math.max(value, point.ts), 0);
    candidates.sort((left, right) =>
      positiveCount(right) - positiveCount(left) ||
      right.length - left.length || latest(right) - latest(left));
    const byTimestamp = new Map();
    for (const point of candidates[0]) byTimestamp.set(point.ts, point);
    return Array.from(byTimestamp.values())
      .sort((left, right) => left.ts - right.ts)
      .slice(-45);
  };
  const stillCurrent = () =>
    window.__homepanelStationheadStatsDocumentActive === true &&
    window.__homepanelStationheadStatsDocumentGeneration ===
      documentGeneration &&
    window.__homepanelStationheadPlayStatsLatestRequestId === requestId;

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
      const clearMatching = name => {
        if (window[name]?.authorization === headers.authorization) {
          window[name] = null;
        }
      };
      clearMatching('__homepanelStationheadAuthHeaders');
      clearMatching('__homepanelStationheadAccountAuthHeaders');
      clearMatching('__homepanelStationheadLatestValidatedAuthHeaders');
      clearMatching('__homepanelStationheadLastAcceptedAuthHeaders');
      window.__homepanelStationheadRejectedAuthorization = headers.authorization;
      post({
        type: 'stationhead-play-stats-auth-failed',
        status: response.status,
        request_id: requestId,
        document_generation: documentGeneration,
        auth_generation: authGeneration,
      });
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
    window.__homepanelStationheadPlayStatsSuccessAt = Date.now();
    window.__homepanelStationheadPlayStatsAuthorization = headers.authorization;
    post({
      type: 'stationhead-play-stats',
      data: { chart_data: chartData },
      source: 'authenticated-api-normalized-v4',
      request_id: requestId,
      document_generation: documentGeneration,
      auth_generation: authGeneration,
      server_date_ms: result.serverDateMs,
      timezone: typeof result.data?.timezone === 'string'
        ? result.data.timezone : '',
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
    if (timeoutTimer) nativeClearTimeout(timeoutTimer);
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
