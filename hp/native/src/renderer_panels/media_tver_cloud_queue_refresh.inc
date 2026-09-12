// Native-owned TVer episode queue and cloud refresh.
//
// The WebView reports media lifecycle events only. Episode ordering, consumed
// state, cloud refreshes, queue exhaustion and startup deadlines all live here
// so page JavaScript never owns playback progression.
namespace {
constexpr ULONGLONG kNativeMediaTverCloudQueueRefreshMs =
    30ULL * 60ULL * 1000ULL;
constexpr ULONGLONG kNativeMediaTverStartupTimeoutMs = 30ULL * 1000ULL;

struct NativeMediaTverCloudQueueRefreshResult {
  std::wstring generatedAt;
  std::vector<std::wstring> episodeIds;
  bool success = false;
};

struct NativeMediaTverNativeQueueState {
  std::mutex mutex;
  uint64_t generation = 1;
  ULONGLONG lastAttemptAt = 0;
  bool phaseActive = false;
  bool inFlight = false;
  std::optional<NativeMediaTverCloudQueueRefreshResult> ready;
  std::vector<std::wstring> latestEpisodeIds;
  std::vector<std::wstring> queueEpisodeIds;
  std::vector<std::wstring> consumedEpisodeIds;
  std::wstring currentEpisodeId;
  std::wstring appliedGeneratedAt;
  ULONGLONG navigationStartedAt = 0;
  bool mediaReady = false;
};

NativeMediaTverNativeQueueState& NativeMediaTverNativeQueue() {
  static NativeMediaTverNativeQueueState state;
  return state;
}

bool NativeMediaTverContainsId(
    const std::vector<std::wstring>& values,
    std::wstring_view id) noexcept {
  return std::find_if(
             values.begin(), values.end(),
             [id](const std::wstring& value) { return value == id; }) !=
      values.end();
}

std::wstring NativeMediaTverEpisodeUrl(std::wstring_view id) {
  if (!NativeMediaTverIdIsSafe(id)) return {};
  return L"https://tver.jp/episodes/" + std::wstring(id);
}

bool NativeMediaTverSourceMatchesEpisode(
    std::wstring_view source, std::wstring_view id) noexcept {
  if (!NativeMediaTverIdIsSafe(id)) return false;
  const std::wstring marker = L"https://tver.jp/episodes/" + std::wstring(id);
  if (source.compare(0, marker.size(), marker) != 0) return false;
  if (source.size() == marker.size()) return true;
  const wchar_t suffix = source[marker.size()];
  return suffix == L'?' || suffix == L'#' || suffix == L'/';
}

void NativeMediaTverRebuildQueueLocked(
    NativeMediaTverNativeQueueState& state) {
  std::vector<std::wstring> rebuilt;
  if (!state.currentEpisodeId.empty()) {
    // Never interrupt an episode that is already selected. If a refresh removes
    // it, ordinary completion or the native startup timeout fails forward.
    rebuilt.push_back(state.currentEpisodeId);
  }
  for (const auto& id : state.latestEpisodeIds) {
    if (id == state.currentEpisodeId ||
        NativeMediaTverContainsId(state.consumedEpisodeIds, id) ||
        NativeMediaTverContainsId(rebuilt, id)) {
      continue;
    }
    rebuilt.push_back(id);
  }

  // Queue exhaustion starts a fresh cycle from the newest cloud snapshot. This
  // replaces the old sessionStorage removal + data-page bootstrap round trip.
  if (rebuilt.empty() && !state.latestEpisodeIds.empty()) {
    state.consumedEpisodeIds.clear();
    rebuilt = state.latestEpisodeIds;
  }
  state.queueEpisodeIds = std::move(rebuilt);
}

void NativeMediaTverApplyReadyLocked(NativeMediaTverNativeQueueState& state) {
  if (!state.ready) return;
  NativeMediaTverCloudQueueRefreshResult result = std::move(*state.ready);
  state.ready.reset();
  if (!result.success || result.episodeIds.empty()) return;
  if (!state.appliedGeneratedAt.empty() &&
      result.generatedAt < state.appliedGeneratedAt) {
    return;
  }
  state.appliedGeneratedAt = std::move(result.generatedAt);
  state.latestEpisodeIds = std::move(result.episodeIds);
  NativeMediaTverRebuildQueueLocked(state);
}

void NativeMediaTverPrepareCloudQueueRefresh(
    HWND hostWindow, const std::shared_ptr<std::atomic<bool>>& alive,
    bool force) noexcept {
  if (!hostWindow || !IsWindow(hostWindow) || !alive) return;
  auto& state = NativeMediaTverNativeQueue();
  uint64_t generation = 0;
  bool startWorker = false;
  {
    std::lock_guard lock(state.mutex);
    if (!state.phaseActive) return;
    NativeMediaTverApplyReadyLocked(state);
    ULONGLONG now = GetTickCount64();
    if (now == 0) now = 1;
    if (!state.inFlight &&
        (force || !state.lastAttemptAt ||
         now - state.lastAttemptAt >= kNativeMediaTverCloudQueueRefreshMs)) {
      state.inFlight = true;
      state.lastAttemptAt = now;
      generation = state.generation;
      startWorker = true;
    }
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
        }
      }

      if (!alive->load(std::memory_order_acquire)) return;
      auto& shared = NativeMediaTverNativeQueue();
      bool postWake = false;
      {
        std::lock_guard lock(shared.mutex);
        if (!shared.phaseActive || shared.generation != generation) return;
        shared.inFlight = false;
        if (result.success) {
          shared.ready = std::move(result);
          postWake = true;
        } else {
          // The 30-minute interval applies only after a successful refresh.
          // A transient startup failure must remain eligible for the ordinary
          // three-second navigation retry instead of blanking TVer for 30 min.
          shared.lastAttemptAt = 0;
        }
      }
      if (postWake && IsWindow(hostWindow)) {
        PostMessageW(hostWindow, WM_TIMER, kNativeMediaTverWatchdogTimer, 0);
      }
    }).detach();
  } catch (...) {
    std::lock_guard lock(state.mutex);
    if (state.generation == generation) {
      state.inFlight = false;
      state.lastAttemptAt = 0;
    }
  }
}

void NativeMediaTverBeginQueuePhase(
    HWND hostWindow,
    const std::shared_ptr<std::atomic<bool>>& alive) noexcept {
  auto& state = NativeMediaTverNativeQueue();
  {
    std::lock_guard lock(state.mutex);
    ++state.generation;
    if (state.generation == 0) ++state.generation;
    state.lastAttemptAt = 0;
    state.phaseActive = true;
    state.inFlight = false;
    state.ready.reset();
    state.latestEpisodeIds.clear();
    state.queueEpisodeIds.clear();
    state.consumedEpisodeIds.clear();
    state.currentEpisodeId.clear();
    state.appliedGeneratedAt.clear();
    state.navigationStartedAt = 0;
    state.mediaReady = false;
  }
  NativeMediaTverPrepareCloudQueueRefresh(hostWindow, alive, true);
}

void NativeMediaTverEndQueuePhase() noexcept {
  auto& state = NativeMediaTverNativeQueue();
  std::lock_guard lock(state.mutex);
  ++state.generation;
  if (state.generation == 0) ++state.generation;
  state.phaseActive = false;
  state.inFlight = false;
  state.ready.reset();
  state.latestEpisodeIds.clear();
  state.queueEpisodeIds.clear();
  state.consumedEpisodeIds.clear();
  state.currentEpisodeId.clear();
  state.appliedGeneratedAt.clear();
  state.navigationStartedAt = 0;
  state.mediaReady = false;
}

std::wstring NativeMediaTverCurrentEpisodeUrl(
    HWND hostWindow,
    const std::shared_ptr<std::atomic<bool>>& alive) noexcept {
  NativeMediaTverPrepareCloudQueueRefresh(hostWindow, alive, false);
  auto& state = NativeMediaTverNativeQueue();
  std::lock_guard lock(state.mutex);
  if (!state.phaseActive) return {};
  NativeMediaTverApplyReadyLocked(state);
  if (state.currentEpisodeId.empty()) {
    if (state.queueEpisodeIds.empty()) {
      NativeMediaTverRebuildQueueLocked(state);
    }
    if (state.queueEpisodeIds.empty()) return {};
    state.currentEpisodeId = state.queueEpisodeIds.front();
    state.navigationStartedAt = 0;
    state.mediaReady = false;
  }
  return NativeMediaTverEpisodeUrl(state.currentEpisodeId);
}

void NativeMediaTverMarkNavigationStarted(std::wstring_view url) noexcept {
  auto& state = NativeMediaTverNativeQueue();
  std::lock_guard lock(state.mutex);
  if (!state.phaseActive || state.currentEpisodeId.empty() ||
      !NativeMediaTverSourceMatchesEpisode(url, state.currentEpisodeId)) {
    return;
  }
  ULONGLONG now = GetTickCount64();
  state.navigationStartedAt = now == 0 ? 1 : now;
  state.mediaReady = false;
}

void NativeMediaTverMarkMediaReady(std::wstring_view source) noexcept {
  auto& state = NativeMediaTverNativeQueue();
  std::lock_guard lock(state.mutex);
  if (!state.phaseActive || state.currentEpisodeId.empty() ||
      !NativeMediaTverSourceMatchesEpisode(source, state.currentEpisodeId)) {
    return;
  }
  state.mediaReady = true;
  state.navigationStartedAt = 0;
}

bool NativeMediaTverStartupExpired(
    std::wstring_view source, ULONGLONG now) noexcept {
  auto& state = NativeMediaTverNativeQueue();
  std::lock_guard lock(state.mutex);
  if (!state.phaseActive || state.mediaReady ||
      state.navigationStartedAt == 0 || state.currentEpisodeId.empty() ||
      !NativeMediaTverSourceMatchesEpisode(source, state.currentEpisodeId)) {
    return false;
  }
  return now >= state.navigationStartedAt &&
      now - state.navigationStartedAt >= kNativeMediaTverStartupTimeoutMs;
}

bool NativeMediaTverAdvanceEpisode(std::wstring_view source) noexcept {
  auto& state = NativeMediaTverNativeQueue();
  std::lock_guard lock(state.mutex);
  if (!state.phaseActive || state.currentEpisodeId.empty() ||
      !NativeMediaTverSourceMatchesEpisode(source, state.currentEpisodeId)) {
    return false;
  }

  if (!NativeMediaTverContainsId(
          state.consumedEpisodeIds, state.currentEpisodeId)) {
    state.consumedEpisodeIds.push_back(state.currentEpisodeId);
  }
  const auto current = std::find(
      state.queueEpisodeIds.begin(), state.queueEpisodeIds.end(),
      state.currentEpisodeId);
  if (current != state.queueEpisodeIds.end()) {
    state.queueEpisodeIds.erase(current);
  }
  state.currentEpisodeId.clear();
  state.navigationStartedAt = 0;
  state.mediaReady = false;
  NativeMediaTverRebuildQueueLocked(state);
  return !state.queueEpisodeIds.empty();
}

void PrepareNativeMediaTverCloudQueueRefresh(
    ICoreWebView2*, HWND hostWindow,
    const std::shared_ptr<std::atomic<bool>>& alive) noexcept {
  NativeMediaTverPrepareCloudQueueRefresh(hostWindow, alive, false);
}
}  // namespace
