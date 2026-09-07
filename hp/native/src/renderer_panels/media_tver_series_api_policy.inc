// TVer series API policy. Owns resolving seasons and published episode IDs when
// the series DOM has not materialized an episode list.
namespace {
constexpr wchar_t kNativeMediaTverSeriesApiPolicyModuleScript[] = LR"JS(
(() => {
  window.__homePanelTverSeriesApiWatchdog = () => {
    if (location.hostname !== 'tver.jp' ||
        !location.pathname.startsWith('/series/')) return null;

    const seriesPath = location.pathname;
    const stateKey = '__homePanelTverSeriesApiResolver';
    const now = Date.now();
    let state = window[stateKey];
    if (!state || state.seriesPath !== seriesPath) {
      state = { seriesPath, inFlight: false, failedAt: 0 };
      window[stateKey] = state;
    }
    if (state.inFlight) return null;
    if (state.failedAt && now - state.failedAt < 15000) {
      return '__homePanelTverUseDomFallback';
    }

    const parts = seriesPath.split('/').filter(Boolean);
    const seriesId = parts.length === 2 && parts[0] === 'series' ? parts[1] : '';
    if (!seriesId || !/^[a-z0-9]+$/i.test(seriesId)) {
      return '__homePanelTverUseDomFallback';
    }

    const apiHeaders = { 'x-tver-platform-type': 'web' };
    const fetchJson = (url, options) => {
      const request = options || {};
      const headers = Object.assign({}, apiHeaders, request.headers || {});
      return fetch(url, Object.assign({}, request, { headers })).then(response => {
        if (!response.ok) throw new Error('TVer API ' + response.status);
        return response.json();
      });
    };
    const contentsOf = payload => {
      const result = payload && payload.result;
      return result && Array.isArray(result.contents) ? result.contents : [];
    };

    state.inFlight = true;
    state.failedAt = 0;
    fetchJson(
        'https://service-api.tver.jp/api/v1/callSeriesSeasons/' +
        encodeURIComponent(seriesId))
      .then(seasonsPayload => {
        const seasonIds = contentsOf(seasonsPayload)
          .filter(item => item && item.type === 'season' && item.content &&
              typeof item.content.id === 'string')
          .map(item => item.content.id);
        if (!seasonIds.length) throw new Error('TVer series has no seasons');
        return fetchJson(
          'https://platform-api.tver.jp/v2/api/platform_users/browser/create',
          {
            method: 'POST',
            headers: {
              'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
            },
            body: 'device_type=pc',
          },
        ).then(sessionPayload => ({ seasonIds, sessionPayload }));
      })
      .then(value => {
        const session = value.sessionPayload && value.sessionPayload.result;
        const uid = session && session.platform_uid;
        const token = session && session.platform_token;
        if (!uid || !token) throw new Error('TVer platform session unavailable');
        const query = '?platform_uid=' + encodeURIComponent(uid) +
            '&platform_token=' + encodeURIComponent(token);
        return Promise.all(value.seasonIds.map(seasonId => fetchJson(
          'https://platform-api.tver.jp/service/api/v1/callSeasonEpisodes/' +
              encodeURIComponent(seasonId) + query,
        )));
      })
      .then(seasonPayloads => {
        const episodeIds = [];
        for (const payload of seasonPayloads) {
          for (const item of contentsOf(payload)) {
            if (!item || item.type !== 'episode' || !item.content ||
                typeof item.content.id !== 'string') continue;
            episodeIds.push(item.content.id);
          }
        }
        const hrefs = Array.from(new Set(episodeIds)).map(
          id => location.origin + '/episodes/' + encodeURIComponent(id));
        if (!hrefs.length) throw new Error('TVer series has no published episodes');
        if (window[stateKey] !== state || location.pathname !== seriesPath) return;
        state.inFlight = false;
        try {
          sessionStorage.setItem('__homePanelTverSeriesPath', seriesPath);
          sessionStorage.setItem(
              '__homePanelTverEpisodeQueue:' + seriesPath,
              JSON.stringify({ hrefs, index: 0 }));
        } catch (_) {
        }
        location.replace(hrefs[0]);
      })
      .catch(() => {
        if (window[stateKey] !== state) return;
        state.inFlight = false;
        state.failedAt = Date.now();
      });
    return null;
  };
})()
)JS";
}  // namespace
