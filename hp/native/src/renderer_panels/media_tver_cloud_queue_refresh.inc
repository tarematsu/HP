// Periodically reconcile the active TVer episode queue with the cloud feed.
// Network I/O stays native so TVer's page CSP cannot block feed refreshes. The
// current episode and already-played prefix are preserved while the current
// episode remains valid; stale or unplayable episodes fail forward.
namespace {
constexpr ULONGLONG kNativeMediaTverCloudQueueRefreshMs =
    30ULL * 60ULL * 1000ULL;

struct NativeMediaTverCloudQueueRefreshResult {
  std::wstring generatedAt;
  std::vector<std::wstring> episodeIds;
  bool success = false;
};

struct NativeMediaTverCloudQueueRefreshState {
  std::mutex mutex;
  ICoreWebView2* webviewIdentity = nullptr;  // Identity only; never dereferenced by worker.
  uint64_t generation = 0;
  ULONGLONG lastAttemptAt = 0;
  bool inFlight = false;
  std::optional<NativeMediaTverCloudQueueRefreshResult> ready;
  std::wstring appliedGeneratedAt;
};

NativeMediaTverCloudQueueRefreshState& NativeMediaTverCloudQueueRefresh() {
  static NativeMediaTverCloudQueueRefreshState state;
  return state;
}

std::wstring NativeMediaTverBuildCloudQueueRefreshScript(
    const NativeMediaTverCloudQueueRefreshResult& result) {
  if (!result.success || result.episodeIds.empty()) return {};

  std::wstring script = LR"JS(
(() => {
  if (location.hostname !== 'tver.jp' ||
      !location.pathname.startsWith('/episodes/')) return false;
  const fresh = [)JS";
  for (size_t index = 0; index < result.episodeIds.size(); ++index) {
    const auto& episodeId = result.episodeIds[index];
    if (!NativeMediaTverIdIsSafe(episodeId)) return {};
    if (index) script += L",";
    script += L"'https://tver.jp/episodes/" + episodeId + L"'";
  }
  script += LR"JS(];

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

  const queueKey = '__homePanelTverEpisodeQueue';
  const missingVideoGuardKey = '__homePanelTverMissingVideoGuard';
  const missingVideoGuardMs = 30000;
  const freshEpisodes = fresh.map(normalizeEpisodeUrl).filter(Boolean);
  if (!freshEpisodes.length) return false;

  let queue;
  try {
    queue = JSON.parse(sessionStorage.getItem(queueKey) || 'null');
  } catch (_) {
    return false;
  }

  const currentUrl = normalizeEpisodeUrl(location.href);
  if (!currentUrl) return false;
  const currentStillFresh = freshEpisodes.some(href => {
    try { return new URL(href).pathname === location.pathname; }
    catch (_) { return false; }
  });

  // If the cloud feed has already dropped this episode, do not preserve it in
  // the played prefix. Move directly to the first currently valid episode.
  if (!currentStillFresh) {
    try {
      sessionStorage.setItem(
        queueKey,
        JSON.stringify({ hrefs: freshEpisodes, index: 0 })
      );
      location.replace(freshEpisodes[0]);
      return true;
    } catch (_) {
      return false;
    }
  }

  const previous = queue && Array.isArray(queue.hrefs)
      ? queue.hrefs.map(normalizeEpisodeUrl).filter(Boolean)
      : [];
  const currentIndex = previous.findIndex(href => {
    try { return new URL(href).pathname === location.pathname; }
    catch (_) { return false; }
  });
  const prefix = currentIndex >= 0
      ? previous.slice(0, currentIndex + 1)
      : [currentUrl];
  if (!prefix.length || prefix[prefix.length - 1] !== currentUrl) return false;

  const seen = new Set(prefix);
  const remaining = [];
  for (const href of freshEpisodes) {
    if (!href || seen.has(href)) continue;
    seen.add(href);
    remaining.push(href);
  }
  const hrefs = prefix.concat(remaining);
  try {
    sessionStorage.setItem(
      queueKey,
      JSON.stringify({ hrefs, index: prefix.length - 1 })
    );
  } catch (_) {
    return false;
  }

  // A stale TVer episode can keep the /episodes/... URL while never creating a
  // playable media element. Give ordinary page/player startup 30 seconds, then
  // fail forward through the existing cloud-owned queue. This is a one-shot
  // guard and therefore adds no steady-state polling cost.
  try {
    if (window[missingVideoGuardKey]) {
      window.clearTimeout(window[missingVideoGuardKey]);
      window[missingVideoGuardKey] = 0;
    }
    const guardedPath = location.pathname;
    window[missingVideoGuardKey] = window.setTimeout(() => {
      window[missingVideoGuardKey] = 0;
      if (location.pathname !== guardedPath) return;
      const playableVideo = Array.from(document.querySelectorAll('video')).some(video => {
        const duration = Number.isFinite(video.duration) ? video.duration : 0;
        const source = String(video.currentSrc || video.src || '');
        return source && (video.readyState >= 1 || duration > 0);
      });
      if (playableVideo) return;

      let latestQueue = null;
      try {
        latestQueue = JSON.parse(sessionStorage.getItem(queueKey) || 'null');
      } catch (_) {}
      const latestHrefs = latestQueue && Array.isArray(latestQueue.hrefs)
          ? latestQueue.hrefs.map(normalizeEpisodeUrl).filter(Boolean)
          : [];
      const latestIndex = latestHrefs.findIndex(href => {
        try { return new URL(href).pathname === location.pathname; }
        catch (_) { return false; }
      });
      const storedIndex = latestQueue && Number.isInteger(latestQueue.index)
          ? latestQueue.index : -1;
      const nextIndex = (latestIndex >= 0 ? latestIndex : storedIndex) + 1;
      if (nextIndex >= 0 && nextIndex < latestHrefs.length) {
        try {
          sessionStorage.setItem(
            queueKey,
            JSON.stringify({ hrefs: latestHrefs, index: nextIndex })
          );
          location.replace(latestHrefs[nextIndex]);
          return;
        } catch (_) {}
      }

      // Queue exhaustion is handled by the native watchdog. Removing the queue
      // makes the ordinary episode guard request a clean TVer restart.
      try { sessionStorage.removeItem(queueKey); } catch (_) {}
      try { window.chrome?.webview?.postMessage('homepanel:tver-wake'); } catch (_) {}
    }, missingVideoGuardMs);
  } catch (_) {}
  return true;
})()
)JS";
  return script;
}

void ApplyNativeMediaTverCloudQueueRefresh(
    ICoreWebView2* webview,
    const std::shared_ptr<std::atomic<bool>>& alive,
    NativeMediaTverCloudQueueRefreshResult result) noexcept {
  if (!webview || !alive || !alive->load(std::memory_order_acquire) ||
      !result.success || result.episodeIds.empty()) {
    return;
  }

  auto& state = NativeMediaTverCloudQueueRefresh();
  {
    std::lock_guard lock(state.mutex);
    if (state.webviewIdentity != webview ||
        (!state.appliedGeneratedAt.empty() &&
         result.generatedAt <= state.appliedGeneratedAt)) {
      return;
    }
  }

  const std::wstring generatedAt = result.generatedAt;
  const std::wstring script = NativeMediaTverBuildCloudQueueRefreshScript(result);
  if (script.empty()) return;
  const auto safeAlive = alive;
  ComPtr<ICoreWebView2> requestView = webview;
  const HRESULT started = requestView->ExecuteScript(
      script.c_str(),
      Callback<ICoreWebView2ExecuteScriptCompletedHandler>(
          [requestView, safeAlive, generatedAt](
              HRESULT executeResult, LPCWSTR json) -> HRESULT {
            if (!safeAlive->load(std::memory_order_acquire) || !requestView ||
                FAILED(executeResult) || !json ||
                std::wstring_view(json) != L"true") {
              return S_OK;
            }
            auto& shared = NativeMediaTverCloudQueueRefresh();
            std::lock_guard lock(shared.mutex);
            if (shared.webviewIdentity != requestView.Get()) return S_OK;
            if (shared.appliedGeneratedAt.empty() ||
                generatedAt > shared.appliedGeneratedAt) {
              shared.appliedGeneratedAt = generatedAt;
            }
            return S_OK;
          }).Get());
  if (FAILED(started)) {
    std::lock_guard lock(state.mutex);
    if (state.webviewIdentity == webview) state.ready = std::move(result);
  }
}

void PrepareNativeMediaTverCloudQueueRefresh(
    ICoreWebView2* webview, HWND hostWindow,
    const std::shared_ptr<std::atomic<bool>>& alive) noexcept {
  if (!webview || !hostWindow || !IsWindow(hostWindow) || !alive) return;

  auto& state = NativeMediaTverCloudQueueRefresh();
  std::optional<NativeMediaTverCloudQueueRefreshResult> ready;
  uint64_t generation = 0;
  bool startWorker = false;
  {
    std::lock_guard lock(state.mutex);
    if (state.webviewIdentity != webview) {
      state.webviewIdentity = webview;
      ++state.generation;
      state.lastAttemptAt = 0;
      state.inFlight = false;
      state.ready.reset();
      state.appliedGeneratedAt.clear();
    }

    if (state.ready) {
      ready = std::move(state.ready);
      state.ready.reset();
    }

    ULONGLONG now = GetTickCount64();
    if (now == 0) now = 1;
    if (!ready && !state.inFlight &&
        (!state.lastAttemptAt ||
         now - state.lastAttemptAt >= kNativeMediaTverCloudQueueRefreshMs)) {
      state.inFlight = true;
      state.lastAttemptAt = now;
      generation = state.generation;
      startWorker = true;
    }
  }

  if (ready && ready->success) {
    ApplyNativeMediaTverCloudQueueRefresh(
        webview, alive, std::move(*ready));
  }
  if (!startWorker) return;

  try {
    std::thread([generation, hostWindow, alive] {
      NativeMediaTverComApartment apartment;
      NativeMediaTverCloudQueueRefreshResult result;
      if (SUCCEEDED(apartment.result)) {
        try {
          const auto cloudFeed = NativeMediaTverParseCloudFeed(
              NativeMediaTverFetchCloudFeed());
          result.generatedAt =
              cloudFeed.GetNamedString(L"generatedAt", L"").c_str();
          result.episodeIds = NativeMediaTverCloudFeedEpisodeIds(cloudFeed);
          result.success = !result.generatedAt.empty() &&
              !result.episodeIds.empty();
        } catch (...) {
          result.success = false;
          result.generatedAt.clear();
          result.episodeIds.clear();
        }
      }

      if (!alive->load(std::memory_order_acquire)) return;
      auto& shared = NativeMediaTverCloudQueueRefresh();
      bool postWake = false;
      {
        std::lock_guard lock(shared.mutex);
        if (shared.generation != generation) return;
        shared.inFlight = false;
        if (result.success) {
          shared.ready = std::move(result);
          postWake = true;
        }
      }
      if (postWake && IsWindow(hostWindow)) {
        PostMessageW(hostWindow, WM_TIMER, kNativeMediaTverWatchdogTimer, 0);
      }
    }).detach();
  } catch (...) {
    std::lock_guard lock(state.mutex);
    if (state.generation == generation) state.inFlight = false;
  }
}
}  // namespace