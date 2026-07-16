from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    print(f"{label}: {count} match(es)")
    if count != 1:
        raise SystemExit(f"{label}: expected one match, found {count}")
    return text.replace(old, new, 1)


def replace_region(text: str, start: str, end: str, replacement: str, label: str) -> str:
    start_index = text.find(start)
    if start_index < 0:
        raise SystemExit(f"{label}: start marker not found")
    end_index = text.find(end, start_index)
    if end_index < 0:
        raise SystemExit(f"{label}: end marker not found")
    return text[:start_index] + replacement + text[end_index:]


header_path = Path("native/src/web_renderer.h")
header = header_path.read_text(encoding="utf-8")
header = replace_once(
    header,
    '''struct NativePlaybackProjection {
  bool available = false;
  bool playing = false;
  int currentIndex = 0;
  int64_t progressMs = 0;
  int64_t anchorAt = 0;
  int64_t sampledAt = 0;
  int64_t queueEndAt = 0;
  int64_t fetchedAt = 0;
  std::vector<NativePlaybackTrack> queue;
};

struct NativePlaybackRender {
  bool available = false;
  bool hasTrack = false;
  bool playing = false;
  int64_t progressMs = 0;
  NativePlaybackTrack track;
};
''',
    '''struct NativePlaybackProjection {
  bool available = false;
  bool playing = false;
  bool stale = false;
  bool ended = false;
  bool setupRequired = false;
  int currentIndex = -1;
  int64_t progressMs = 0;
  int64_t anchorAt = 0;
  int64_t sampledAt = 0;
  int64_t queueEndAt = 0;
  int64_t fetchedAt = 0;
  std::vector<NativePlaybackTrack> queue;
};

struct NativePlaybackRender {
  bool available = false;
  bool hasTrack = false;
  bool playing = false;
  bool stale = false;
  bool ended = false;
  bool setupRequired = false;
  int64_t progressMs = 0;
  NativePlaybackTrack track;
};
''',
    "extend playback projection state",
)
header_path.write_text(header, encoding="utf-8")


playback_path = Path("native/src/dashboard_native_playback.cpp")
playback = playback_path.read_text(encoding="utf-8")
helper_anchor = '''JsonObject FirstObject(const JsonObject& object,
                       std::initializer_list<const wchar_t*> names) {
  for (const wchar_t* name : names) {
    JsonObject value = json::Object(object, name);
    if (value.Size() != 0) return value;
  }
  return JsonObject{};
}

'''
helpers = helper_anchor + '''std::optional<bool> FirstBoolean(
    const JsonObject& object, std::initializer_list<const wchar_t*> names) {
  for (const wchar_t* name : names) {
    try {
      if (object.HasKey(name) &&
          object.GetNamedValue(name).ValueType() == JsonValueType::Boolean) {
        return object.GetNamedBoolean(name);
      }
    } catch (...) {
    }
  }
  return std::nullopt;
}

std::optional<bool> FirstBooleanAcross(
    const JsonObject& first, const JsonObject& second, const JsonObject& third,
    std::initializer_list<const wchar_t*> names) {
  if (const auto value = FirstBoolean(first, names)) return value;
  if (const auto value = FirstBoolean(second, names)) return value;
  return FirstBoolean(third, names);
}

std::optional<int> FirstInteger(
    const JsonObject& object, std::initializer_list<const wchar_t*> names) {
  for (const wchar_t* name : names) {
    try {
      if (!object.HasKey(name) ||
          object.GetNamedValue(name).ValueType() != JsonValueType::Number) {
        continue;
      }
      const double value = object.GetNamedNumber(name);
      if (!std::isfinite(value) ||
          value < static_cast<double>(std::numeric_limits<int>::min()) ||
          value > static_cast<double>(std::numeric_limits<int>::max())) {
        continue;
      }
      return static_cast<int>(std::trunc(value));
    } catch (...) {
    }
  }
  return std::nullopt;
}

std::optional<int> FirstIntegerAcross(
    const JsonObject& first, const JsonObject& second, const JsonObject& third,
    std::initializer_list<const wchar_t*> names) {
  if (const auto value = FirstInteger(first, names)) return value;
  if (const auto value = FirstInteger(second, names)) return value;
  return FirstInteger(third, names);
}

struct PlaybackContractState {
  bool queuePlayingPresent = false;
  bool queuePlaying = false;
  bool topLevelPlayingPresent = false;
  bool topLevelPlaying = false;
  bool broadcasting = false;
  bool paused = false;
  bool ended = false;
  bool stale = false;
  bool setupRequired = false;
  bool currentIndexPresent = false;
  int currentIndex = -1;
  int currentMarkerIndex = -1;
  int queueSize = 0;
};

constexpr int ResolveContractCurrentIndex(const PlaybackContractState& state) {
  if (state.queueSize <= 0 || state.ended || state.setupRequired) return -1;
  if (state.currentIndexPresent) {
    return state.currentIndex >= 0 && state.currentIndex < state.queueSize
        ? state.currentIndex
        : -1;
  }
  if (state.currentMarkerIndex >= 0 && state.currentMarkerIndex < state.queueSize) {
    return state.currentMarkerIndex;
  }
  const bool legacyPlaying = state.queuePlayingPresent
      ? state.queuePlaying
      : (state.topLevelPlayingPresent ? state.topLevelPlaying : state.broadcasting);
  return legacyPlaying ? 0 : -1;
}

constexpr bool ResolveContractPlaying(const PlaybackContractState& state,
                                      int currentIndex) {
  if (currentIndex < 0 || state.paused || state.ended || state.stale ||
      state.setupRequired) {
    return false;
  }
  if (state.queuePlayingPresent) return state.queuePlaying;
  if (state.topLevelPlayingPresent) return state.topLevelPlaying;
  return state.broadcasting;
}

constexpr PlaybackContractState EndedQueueContractSample() {
  PlaybackContractState state;
  state.queuePlayingPresent = true;
  state.queuePlaying = false;
  state.topLevelPlayingPresent = true;
  state.topLevelPlaying = false;
  state.broadcasting = true;
  state.ended = true;
  state.stale = true;
  state.currentIndexPresent = true;
  state.currentIndex = -1;
  state.queueSize = 60;
  return state;
}

constexpr PlaybackContractState ExplicitNoCurrentContractSample() {
  PlaybackContractState state;
  state.topLevelPlayingPresent = true;
  state.topLevelPlaying = true;
  state.broadcasting = true;
  state.currentIndexPresent = true;
  state.currentIndex = -1;
  state.queueSize = 3;
  return state;
}

constexpr PlaybackContractState LegacyBroadcastContractSample() {
  PlaybackContractState state;
  state.broadcasting = true;
  state.queueSize = 3;
  return state;
}

static_assert(ResolveContractCurrentIndex(EndedQueueContractSample()) == -1);
static_assert(!ResolveContractPlaying(EndedQueueContractSample(), -1));
static_assert(ResolveContractCurrentIndex(ExplicitNoCurrentContractSample()) == -1);
static_assert(!ResolveContractPlaying(ExplicitNoCurrentContractSample(), -1));
static_assert(ResolveContractCurrentIndex(LegacyBroadcastContractSample()) == 0);
static_assert(ResolveContractPlaying(LegacyBroadcastContractSample(), 0));

'''
playback = replace_once(playback, helper_anchor, helpers, "add playback contract helpers")

new_parser = '''NativePlaybackProjection ParsePlaybackProjection(const fs::path& dataDir,
                                                  const std::wstring& payload,
                                                  int64_t fetchedAt) {
  NativePlaybackProjection projection;
  projection.fetchedAt = fetchedAt;
  if (payload.empty()) return projection;
  try {
    const JsonObject root = JsonObject::Parse(payload);
    const JsonObject value = UnwrapPlaybackPayload(root);
    const PlaybackQueueSource queueSource = LocatePlaybackQueue(value);
    const JsonObject queueOwner = queueSource.owner;
    const JsonArray queue = queueSource.queue;
    const JsonObject queueStatus = LocateQueueStatus(value, queueOwner);
    const JsonObject itemSource = LocateCurrentItem(value, queueOwner);

    const std::optional<bool> queuePlaying = FirstBoolean(queueStatus, {L"playing"});
    std::optional<bool> topLevelPlaying = FirstBoolean(value, {L"playing"});
    if (!topLevelPlaying) topLevelPlaying = FirstBoolean(queueOwner, {L"playing"});
    const bool statusPaused = FirstBooleanAcross(
        queueStatus, queueOwner, value, {L"is_paused", L"isPaused"}).value_or(false);
    const bool broadcasting = FirstBooleanAcross(
        value, queueOwner, queueStatus,
        {L"is_broadcasting", L"isBroadcasting"}).value_or(false);
    const bool ended = FirstBooleanAcross(
        queueStatus, queueOwner, value, {L"ended"}).value_or(false);
    const bool stale = FirstBooleanAcross(
        value, queueOwner, queueStatus, {L"stale"}).value_or(false);
    const bool setupRequired = FirstBooleanAcross(
        value, queueOwner, queueStatus,
        {L"setup_required", L"setupRequired"}).value_or(false);

    std::optional<int> explicitCurrentIndex = FirstIntegerAcross(
        queueStatus, queueOwner, value, {L"current_index", L"currentIndex"});
    int currentMarkerIndex = -1;
    for (uint32_t queueIndex = 0; queueIndex < queue.Size(); ++queueIndex) {
      try {
        if (queue.GetAt(queueIndex).ValueType() == JsonValueType::Object &&
            json::Boolean(queue.GetAt(queueIndex).GetObject(), L"is_current")) {
          currentMarkerIndex = static_cast<int>(queueIndex);
          break;
        }
      } catch (...) {
      }
    }
    if (queue.Size() == 0 && itemSource.Size() != 0) currentMarkerIndex = 0;

    const int contractQueueSize = queue.Size() > 0
        ? static_cast<int>(std::min<uint32_t>(
              queue.Size(), static_cast<uint32_t>(std::numeric_limits<int>::max())))
        : (itemSource.Size() != 0 ? 1 : 0);
    PlaybackContractState contract;
    contract.queuePlayingPresent = queuePlaying.has_value();
    contract.queuePlaying = queuePlaying.value_or(false);
    contract.topLevelPlayingPresent = topLevelPlaying.has_value();
    contract.topLevelPlaying = topLevelPlaying.value_or(false);
    contract.broadcasting = broadcasting;
    contract.paused = statusPaused;
    contract.ended = ended;
    contract.stale = stale;
    contract.setupRequired = setupRequired;
    contract.currentIndexPresent = explicitCurrentIndex.has_value();
    contract.currentIndex = explicitCurrentIndex.value_or(-1);
    contract.currentMarkerIndex = currentMarkerIndex;
    contract.queueSize = contractQueueSize;

    const int currentIndex = ResolveContractCurrentIndex(contract);
    const bool playing = ResolveContractPlaying(contract, currentIndex);

    const int64_t sampledAt = EpochMilliseconds(FirstNumberAcross(
        value, queueOwner, queueStatus,
        {L"generated_at", L"queue_observed_at", L"latest_observed_at",
         L"sampledAt", L"monitorSampledAt", L"updatedAt"}));
    const int64_t serverReferenceAt = EpochMilliseconds(FirstNumberAcross(
        value, queueOwner, queueStatus,
        {L"generated_at", L"queue_observed_at", L"latest_observed_at",
         L"sampledAt", L"monitorSampledAt", L"updatedAt"}));
    const int64_t anchorAt = EpochMilliseconds(FirstNumberAcross(
        value, queueOwner, queueStatus, {L"anchor_at", L"anchorAt"}));
    const int64_t queueEndAt = EpochMilliseconds(FirstNumberAcross(
        value, queueOwner, queueStatus, {L"queue_end_at", L"queueEndAt"}));
    int64_t durationMs = static_cast<int64_t>(std::max(
        0.0, FirstNumberAcross(value, queueOwner, queueStatus,
                               {L"duration_ms", L"durationMs", L"trackDurationMs"})));
    int64_t progressMs = static_cast<int64_t>(std::max(
        0.0, FirstNumberAcross(value, queueOwner, queueStatus,
                               {L"progress_ms", L"progressMs", L"positionMs"})));

    if (queue.Size() > 0) {
      projection.queue.reserve(queue.Size());
      for (uint32_t queueIndex = 0; queueIndex < queue.Size(); ++queueIndex) {
        try {
          if (queue.GetAt(queueIndex).ValueType() == JsonValueType::Object) {
            projection.queue.push_back(
                NormalizeTrack(dataDir, queue.GetAt(queueIndex).GetObject()));
            continue;
          }
        } catch (...) {
        }
        projection.queue.emplace_back();
      }

      if (currentIndex >= 0 && currentIndex < static_cast<int>(queue.Size())) {
        if (progressMs <= 0) {
          try {
            if (queue.GetAt(currentIndex).ValueType() == JsonValueType::Object) {
              progressMs = static_cast<int64_t>(std::max(
                  0.0, FirstNumber(queue.GetAt(currentIndex).GetObject(),
                                   {L"progress_ms", L"progressMs", L"positionMs"})));
            }
          } catch (...) {
          }
        }
        if (durationMs <= 0 && currentIndex < static_cast<int>(projection.queue.size())) {
          durationMs = projection.queue[static_cast<size_t>(currentIndex)].durationMs;
        }

        int64_t elapsed = progressMs;
        if (playing) {
          if (anchorAt > 0 && serverReferenceAt > 0) {
            elapsed = std::max<int64_t>(0, serverReferenceAt - anchorAt) +
                std::max<int64_t>(0, fetchedAt - serverReferenceAt);
          } else if (anchorAt > 0) {
            elapsed = std::max<int64_t>(0, fetchedAt - anchorAt);
          } else if (sampledAt > 0) {
            elapsed += std::max<int64_t>(0, fetchedAt - sampledAt);
          }
        }
        projection.progressMs = std::max<int64_t>(0, elapsed);
      }
      projection.currentIndex = currentIndex;
    } else if (itemSource.Size() != 0) {
      NativePlaybackTrack track = NormalizeTrack(dataDir, itemSource);
      if (durationMs > 0) track.durationMs = durationMs;
      if (currentIndex >= 0) {
        const int64_t expectedEndAt = EpochMilliseconds(FirstNumberAcross(
            value, queueOwner, queueStatus, {L"expected_end_at", L"expectedEndAt"}));
        if (track.durationMs > 0 && expectedEndAt > 0) {
          progressMs = track.durationMs -
              std::max<int64_t>(0, expectedEndAt + kPlaybackTransitionHoldMs - fetchedAt);
        } else if (playing && sampledAt > 0) {
          progressMs += std::max<int64_t>(0, fetchedAt - sampledAt);
        }
        if (track.durationMs > 0) {
          progressMs = std::clamp<int64_t>(progressMs, 0, track.durationMs);
        }
        projection.currentIndex = 0;
        projection.progressMs = std::max<int64_t>(0, progressMs);
      }
      projection.queue.push_back(std::move(track));
    }

    const bool hasTrackData = std::any_of(
        projection.queue.begin(), projection.queue.end(),
        [](const NativePlaybackTrack& track) {
          return !track.title.empty() || !track.artist.empty() ||
              !track.artwork.empty() || track.durationMs > 0;
        });
    projection.available = hasTrackData || stale || ended || setupRequired;
    projection.playing = playing;
    projection.stale = stale;
    projection.ended = ended;
    projection.setupRequired = setupRequired;
    projection.sampledAt = fetchedAt;
    projection.anchorAt = playing ? fetchedAt - projection.progressMs : 0;
    if (queueEndAt > 0 && serverReferenceAt > 0) {
      projection.queueEndAt = fetchedAt + std::max<int64_t>(0, queueEndAt - serverReferenceAt);
    } else {
      projection.queueEndAt = queueEndAt;
    }
    return projection;
  } catch (...) {
    NativePlaybackProjection failed;
    failed.fetchedAt = fetchedAt;
    return failed;
  }
}

'''
playback = replace_region(
    playback,
    "NativePlaybackProjection ParsePlaybackProjection(",
    "std::wstring FetchPlaybackJson(",
    new_parser,
    "replace playback JSON parser",
)
playback_path.write_text(playback, encoding="utf-8")


resolve_path = Path("native/src/dashboard_playback_resolve.cpp")
resolve = resolve_path.read_text(encoding="utf-8")
resolve = replace_once(
    resolve,
    '''  const size_t startIndex = projection.currentIndex > 0 &&
          projection.currentIndex < static_cast<int>(projection.queue.size())
      ? static_cast<size_t>(projection.currentIndex)
      : 0;
''',
    '''  const bool hasCurrentTrack = projection.currentIndex >= 0 &&
      projection.currentIndex < static_cast<int>(projection.queue.size());
  const size_t startIndex = hasCurrentTrack
      ? static_cast<size_t>(projection.currentIndex)
      : projection.queue.size();
''',
    "preserve no-current-track index",
)
resolve = replace_once(
    resolve,
    '''bool PlaybackEndedWithoutNextTrack(const NativePlaybackProjection& projection, int64_t nowMs) {
  if (!projection.available || !projection.playing || projection.queue.empty()) return false;
  const size_t startIndex = projection.currentIndex >= 0 &&
          projection.currentIndex < static_cast<int>(projection.queue.size())
      ? static_cast<size_t>(projection.currentIndex)
      : 0;
''',
    '''bool PlaybackEndedWithoutNextTrack(const NativePlaybackProjection& projection, int64_t nowMs) {
  if (!projection.available || projection.setupRequired) return false;
  if (projection.ended) return true;
  if (!projection.playing || projection.queue.empty() || projection.currentIndex < 0 ||
      projection.currentIndex >= static_cast<int>(projection.queue.size())) {
    return false;
  }
  const size_t startIndex = static_cast<size_t>(projection.currentIndex);
''',
    "honor explicit queue-ended state",
)
old_resolve = '''NativePlaybackRender Renderer::ResolveNativePlaybackLocked(size_t source, int64_t nowMs) const {
  NativePlaybackRender render;
  if (source >= nativePlaybackUpdates_.size()) return render;
  const NativePlaybackProjection& projection = nativePlaybackUpdates_[source].projection;
  if (!projection.available || projection.queue.empty()) return render;
  render.available = true;
  render.playing = projection.playing;
  if (projection.playing && projection.queueEndAt > 0 && nowMs >= projection.queueEndAt) {
    return render;
  }

  const ProjectedTrackPosition position = ResolveProjectedTrackPosition(projection, nowMs);
  if (position.index >= projection.queue.size()) return render;

  render.track = projection.queue[position.index];
  render.hasTrack = !render.track.title.empty();
  render.progressMs = std::max<int64_t>(0, position.elapsedMs);
  if (render.track.durationMs > 0) {
    render.progressMs = std::min(render.progressMs, render.track.durationMs);
  }
  return render;
}
'''
new_resolve = '''NativePlaybackRender Renderer::ResolveNativePlaybackLocked(size_t source, int64_t nowMs) const {
  NativePlaybackRender render;
  if (source >= nativePlaybackUpdates_.size()) return render;
  const NativePlaybackProjection& projection = nativePlaybackUpdates_[source].projection;
  render.available = projection.available;
  render.playing = projection.playing;
  render.stale = projection.stale;
  render.ended = projection.ended;
  render.setupRequired = projection.setupRequired;
  if (!projection.available || projection.queue.empty() || projection.currentIndex < 0 ||
      projection.currentIndex >= static_cast<int>(projection.queue.size())) {
    return render;
  }
  if (projection.playing && projection.queueEndAt > 0 && nowMs >= projection.queueEndAt) {
    return render;
  }

  const ProjectedTrackPosition position = ResolveProjectedTrackPosition(projection, nowMs);
  if (position.index >= projection.queue.size()) return render;

  render.track = projection.queue[position.index];
  render.hasTrack = TrackHasIdentity(render.track);
  render.progressMs = std::max<int64_t>(0, position.elapsedMs);
  if (render.track.durationMs > 0) {
    render.progressMs = std::min(render.progressMs, render.track.durationMs);
  }
  return render;
}
'''
resolve = replace_once(resolve, old_resolve, new_resolve, "resolve explicit no-current state")
resolve = replace_once(
    resolve,
    '''  status.available = projection.available;
  status.playing = projection.playing;
  status.endedWithoutNextTrack = PlaybackEndedWithoutNextTrack(projection, nowMs);
''',
    '''  status.available = projection.available;
  status.playing = projection.playing;
  if (projection.currentIndex >= 0 &&
      projection.currentIndex < static_cast<int>(projection.queue.size())) {
    status.hasTrack = TrackHasIdentity(
        projection.queue[static_cast<size_t>(projection.currentIndex)]);
  }
  status.endedWithoutNextTrack = PlaybackEndedWithoutNextTrack(projection, nowMs);
''',
    "populate playback feed current-track state",
)
resolve = replace_once(
    resolve,
    '''  if (!projection.available || projection.queue.empty()) return state;
  if (projection.playing && projection.queueEndAt > 0 && nowMs >= projection.queueEndAt) {
''',
    '''  if (!projection.available || projection.queue.empty() || projection.currentIndex < 0 ||
      projection.currentIndex >= static_cast<int>(projection.queue.size())) {
    return state;
  }
  if (projection.playing && projection.queueEndAt > 0 && nowMs >= projection.queueEndAt) {
''',
    "disable music ticks without a current track",
)
resolve_path.write_text(resolve, encoding="utf-8")


panel_path = Path("native/src/renderer_panels/part3.inc")
panel = panel_path.read_text(encoding="utf-8")
panel = replace_once(
    panel,
    '''  const std::wstring& rowDetail = sharedPlayback.available && !sharedPlayback.hasTrack
      ? L"次の曲を待機中"
      : detail;
''',
    '''  std::wstring rowDetail = detail;
  if (sharedPlayback.setupRequired) {
    rowDetail = L"再生設定待ち";
  } else if (sharedPlayback.ended) {
    rowDetail = sharedPlayback.stale ? L"キュー終了・情報遅延" : L"キュー終了";
  } else if (sharedPlayback.stale) {
    rowDetail = L"再生情報を更新待ち";
  } else if (sharedPlayback.available && !sharedPlayback.hasTrack) {
    rowDetail = L"次の曲を待機中";
  }
''',
    "render playback contract status",
)
panel_path.write_text(panel, encoding="utf-8")


combined = "\n".join(
    path.read_text(encoding="utf-8")
    for path in [header_path, playback_path, resolve_path, panel_path]
)
for marker in [
    "currentIndex = -1",
    "ResolveContractCurrentIndex(EndedQueueContractSample()) == -1",
    "projection.ended = ended",
    "if (projection.ended) return true",
    "キュー終了・情報遅延",
]:
    if marker not in combined:
        raise SystemExit(f"missing playback-contract marker: {marker}")
if "const bool playing = (statusPlaying || broadcasting)" in combined:
    raise SystemExit("broadcasting is still treated as authoritative playback")
if "index = 0;\n        for (uint32_t queueIndex" in combined:
    raise SystemExit("explicit current_index=-1 still falls back to queue index zero")
