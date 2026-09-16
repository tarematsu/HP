#pragma once

// Namespace-neutral because the native media composition includes this header
// from inside namespace hp. Stationhead uses the same low-frequency status
// polling model as the Spotify cards: polling updates this cache, while WM_PAINT
// only reads the already-computed title.
inline std::mutex stationheadStatusStripTrackMutex;
inline std::wstring stationheadStatusStripTrackTitle;

inline std::wstring ReadStationheadStatusStripCurrentTrackTitle(
    const fs::path& dataDir, int64_t nowMs) noexcept {
  try {
    std::ifstream input(dataDir / L"native-playback-a.json", std::ios::binary);
    if (!input) return {};
    const std::string text((std::istreambuf_iterator<char>(input)), {});
    if (text.empty()) return {};

    const auto root = winrt::Windows::Data::Json::JsonObject::Parse(Utf8ToWide(text));
    const auto playback = root.GetNamedObject(L"playback", nullptr);
    if (!playback) return {};
    if (!playback.GetNamedBoolean(L"available", false) ||
        !playback.GetNamedBoolean(L"playing", false) ||
        playback.GetNamedBoolean(L"stale", false) ||
        playback.GetNamedBoolean(L"ended", false) ||
        playback.GetNamedBoolean(L"setupRequired", false)) {
      return {};
    }

    const auto queue = playback.GetNamedArray(L"queue", nullptr);
    if (!queue || queue.Size() == 0) return {};
    const int currentIndex = static_cast<int>(
        playback.GetNamedNumber(L"currentIndex", -1.0));
    if (currentIndex < 0 || currentIndex >= static_cast<int>(queue.Size())) {
      return {};
    }
    const int64_t queueEndAt = static_cast<int64_t>(
        playback.GetNamedNumber(L"queueEndAt", 0.0));
    if (queueEndAt > 0 && nowMs >= queueEndAt) return {};

    int64_t elapsed = std::max<int64_t>(0, static_cast<int64_t>(
        playback.GetNamedNumber(L"progressMs", 0.0)));
    const int64_t anchorAt = static_cast<int64_t>(
        playback.GetNamedNumber(L"anchorAt", 0.0));
    const int64_t sampledAt = static_cast<int64_t>(
        playback.GetNamedNumber(L"sampledAt", 0.0));
    if (anchorAt > 0) {
      elapsed = std::max<int64_t>(0, nowMs - anchorAt);
    } else if (sampledAt > 0) {
      elapsed += std::max<int64_t>(0, nowMs - sampledAt);
    }

    uint32_t index = static_cast<uint32_t>(currentIndex);
    constexpr int64_t kTrackTransitionHoldMs = 500;
    while (index < queue.Size()) {
      const auto item = queue.GetObjectAt(index);
      const int64_t duration = std::max<int64_t>(0, static_cast<int64_t>(
          item.GetNamedNumber(L"durationMs", 0.0)));
      if (duration <= 0 || elapsed < duration + kTrackTransitionHoldMs) break;
      elapsed -= duration;
      ++index;
    }
    if (index >= queue.Size()) return {};
    return queue.GetObjectAt(index).GetNamedString(L"title", L"").c_str();
  } catch (...) {
    return {};
  }
}

inline void PollStationheadStatusStripCurrentTrackTitle(
    const fs::path& dataDir, int64_t nowMs) noexcept {
  std::wstring next = ReadStationheadStatusStripCurrentTrackTitle(dataDir, nowMs);
  std::lock_guard lock(stationheadStatusStripTrackMutex);
  stationheadStatusStripTrackTitle = std::move(next);
}

inline std::wstring StationheadStatusStripCurrentTrackTitle() noexcept {
  std::lock_guard lock(stationheadStatusStripTrackMutex);
  return stationheadStatusStripTrackTitle;
}

// Compatibility no-op while old Stationhead status objects age out. The native
// header no longer consumes or requests play-count data.
inline void PublishStationheadStatusStripPlayCount(int64_t) noexcept {}
