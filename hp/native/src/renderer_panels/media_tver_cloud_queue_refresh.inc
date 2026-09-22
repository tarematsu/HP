// Native-owned TVer episode queue and cloud refresh.
namespace {
constexpr ULONGLONG kNativeMediaTverCloudQueueRefreshMs =
    30ULL * 60ULL * 1000ULL;
constexpr ULONGLONG kNativeMediaTverStartupTimeoutMs = 30ULL * 1000ULL;

struct NativeMediaTverCloudQueueRefreshResult {
  std::wstring generatedAt;
  std::vector<std::wstring> episodeIds;
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
  std::vector<std::wstring> rejectedEpisodeIds;
  std::wstring currentEpisodeId;
  std::wstring appliedGeneratedAt;
  ULONGLONG navigationStartedAt = 0;
  bool startupReloadPending = false;
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
             [id](const std::wstring& value) {
               return std::wstring_view(value) == id;
             }) != values.end();
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
  if (!state.currentEpisodeId.empty() &&
      !NativeMediaTverContainsId(
          state.rejectedEpisodeIds, state.currentEpisodeId)) {
    rebuilt.push_back(state.currentEpisodeId);
  }
  for (const auto& id : state.latestEpisodeIds) {
    if (id == state.currentEpisodeId ||
        NativeMediaTverContainsId(state.consumedEpisodeIds, id) ||
        NativeMediaTverContainsId(state.rejectedEpisodeIds, id)) {
      continue;
    }
    rebuilt.push_back(id);
  }

  // Queue exhaustion starts a fresh cycle, excluding bad redirects for this phase.
  if (rebuilt.empty() && !state.latestEpisodeIds.empty()) {
    state.consumedEpisodeIds.clear();
    for (const auto& id : state.latestEpisodeIds) {
      if (!NativeMediaTverContainsId(state.rejectedEpisodeIds, id)) {
        rebuilt.push_back(id);
      }
    }
  }
  state.queueEpisodeIds = std::move(rebuilt);
}

void NativeMediaTverApplyReadyLocked(NativeMediaTverNativeQueueState& state) {
  if (!state.ready) return;
  NativeMediaTverCloudQueueRefreshResult result = std::move(*state.ready);
  state.ready.reset();
  if (!state.appliedGeneratedAt.empty() &&
      result.generatedAt < state.appliedGeneratedAt) {
    return;
  }
  state.appliedGeneratedAt = std::move(result.generatedAt);
  state.latestEpisodeIds = std::move(result.episodeIds);
  NativeMediaTverRebuildQueueLocked(state);
}

void NativeMediaTverResetQueuePhaseLocked(
    NativeMediaTverNativeQueueState& state, bool active) noexcept {
  ++state.generation;
  if (state.generation == 0) ++state.generation;
  state.lastAttemptAt = 0;
  state.phaseActive = active;
  state.inFlight = false;
  state.ready.reset();
  state.latestEpisodeIds.clear();
  state.queueEpisodeIds.clear();
  state.consumedEpisodeIds.clear();
  state.rejectedEpisodeIds.clear();
  state.currentEpisodeId.clear();
  state.appliedGeneratedAt.clear();
  state.navigationStartedAt = 0;
  state.startupReloadPending = false;
  state.mediaReady = false;
}

void NativeMediaTverPrepareCloudQueueRefresh(
    HWND hostWindow, const std::shared_ptr<std::atomic<bool>>& alive,
    bool force) noexcept {
  if (!hostWindow || !IsWindow(hostWindow) || !alive) return;
  auto& state = NativeMediaTverNativeQueue();
  uint64_t generation = 0;
  {
    std::lock_guard lock(state.mutex);
    if (!state.phaseActive) return;
    NativeMediaTverApplyReadyLocked(state);
    ULONGLONG now = GetTickCount64();
    if (now == 0) now = 1;
    if (state.inFlight ||
        (!force && state.lastAttemptAt &&
         now - state.lastAttemptAt < kNativeMediaTverCloudQueueRefreshMs)) {
      return;
    }
    state.inFlight = true;
    state.lastAttemptAt = now;
    generation = state.generation;
  }

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
        } catch (...) {}
      }

      if (!alive->load(std::memory_order_acquire)) return;
      auto& shared = NativeMediaTverNativeQueue();
      bool postWake = false;
      {
        std::lock_guard lock(shared.mutex);
        if (!shared.phaseActive || shared.generation != generation) return;
        shared.inFlight = false;
        if (!result.generatedAt.empty() && !result.episodeIds.empty()) {
          shared.ready = std::move(result);
          postWake = true;
        } else {
          // Failed startup stays eligible for the normal navigation retry.
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
    NativeMediaTverResetQueuePhaseLocked(state, true);
  }
  NativeMediaTverPrepareCloudQueueRefresh(hostWindow, alive, true);
}

void NativeMediaTverEndQueuePhase() noexcept {
  auto& state = NativeMediaTverNativeQueue();
  std::lock_guard lock(state.mutex);
  NativeMediaTverResetQueuePhaseLocked(state, false);
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
    if (state.queueEpisodeIds.empty()) NativeMediaTverRebuildQueueLocked(state);
    if (state.queueEpisodeIds.empty()) return {};
    state.currentEpisodeId = state.queueEpisodeIds.front();
    state.navigationStartedAt = 0;
    state.startupReloadPending = false;
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
  state.startupReloadPending = false;
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
  state.startupReloadPending = false;
}

bool NativeMediaTverStartupExpired(
    std::wstring_view source, ULONGLONG now) noexcept {
  auto& state = NativeMediaTverNativeQueue();
  std::lock_guard lock(state.mutex);
  if (!state.phaseActive || state.currentEpisodeId.empty() || source.empty()) {
    return false;
  }
  if (!NativeMediaTverSourceMatchesEpisode(source, state.currentEpisodeId)) {
    // A redirect or stale page is a recovery condition, not evidence that the
    // current episode completed. Reload the current queue item in place.
    state.startupReloadPending = true;
    return true;
  }
  if (!state.mediaReady && !state.latestEpisodeIds.empty() &&
      !NativeMediaTverContainsId(
          state.latestEpisodeIds, state.currentEpisodeId)) {
    // Cloud-feed churn must not silently consume the episode while playback is
    // still unresolved. Keep the same current item until an explicit end.
    state.startupReloadPending = true;
    return true;
  }
  if (state.mediaReady || state.navigationStartedAt == 0) return false;
  if (now < state.navigationStartedAt ||
      now - state.navigationStartedAt < kNativeMediaTverStartupTimeoutMs) {
    return false;
  }

  // Startup recovery is intentionally unbounded. A playback failure may reload
  // the current episode, but it never acquires authority to advance the queue.
  state.startupReloadPending = true;
  return true;
}

bool NativeMediaTverAdvanceEpisode(std::wstring_view source) noexcept {
  auto& state = NativeMediaTverNativeQueue();
  std::lock_guard lock(state.mutex);
  if (!state.phaseActive || state.currentEpisodeId.empty()) return false;

  const bool sourceMatches =
      NativeMediaTverSourceMatchesEpisode(source, state.currentEpisodeId);
  const bool missingFromLatest =
      !state.latestEpisodeIds.empty() &&
      !NativeMediaTverContainsId(
          state.latestEpisodeIds, state.currentEpisodeId);

  // Startup failures and redirects may request navigation, but they never
  // consume the current episode. The host will navigate CurrentEpisodeUrl(),
  // which still resolves to this exact queue item.
  if (state.startupReloadPending) {
    state.startupReloadPending = false;
    state.navigationStartedAt = 0;
    state.mediaReady = false;
    return true;
  }

  // A delayed end message from a previous document must not consume whichever
  // episode happens to be current now.
  if (!sourceMatches) return false;

  if (missingFromLatest) {
    if (!NativeMediaTverContainsId(
            state.rejectedEpisodeIds, state.currentEpisodeId)) {
      state.rejectedEpisodeIds.push_back(state.currentEpisodeId);
    }
    state.lastAttemptAt = 0;
  }

  if (!NativeMediaTverContainsId(
          state.consumedEpisodeIds, state.currentEpisodeId)) {
    state.consumedEpisodeIds.push_back(state.currentEpisodeId);
  }
  const auto current = std::find(
      state.queueEpisodeIds.begin(), state.queueEpisodeIds.end(),
      state.currentEpisodeId);
  if (current != state.queueEpisodeIds.end()) state.queueEpisodeIds.erase(current);
  state.currentEpisodeId.clear();
  state.navigationStartedAt = 0;
  state.mediaReady = false;
  NativeMediaTverRebuildQueueLocked(state);
  return !state.queueEpisodeIds.empty();
}
}  // namespace
