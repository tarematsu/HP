namespace hp {
namespace {

constexpr wchar_t kSpotifyCloudConfigFile[] = L"device-config.json";
constexpr size_t kSpotifyMaxRotationGroups = 32;
constexpr size_t kSpotifyMaxTracksPerGroup = 256;
constexpr size_t kSpotifyMaxTracksPerCycle = 512;
constexpr ULONGLONG kSpotifyInitialCloudSyncSettleMs = 10ULL * 1000ULL;
constexpr ULONGLONG kSpotifyInitialCloudSyncFallbackMs = 30ULL * 1000ULL;
constexpr wchar_t kSpotifyFallbackRotationFingerprint[] = L"<fallback>";

std::wstring ManagedSpotifyPathFromUrl(
    const std::wstring& url, std::wstring_view segment) {
  constexpr std::wstring_view host = L"https://open.spotify.com";
  if (!StartsWithInsensitive(url, host) ||
      (url.size() > host.size() && url[host.size()] != L'/')) {
    return {};
  }
  const size_t begin = url.find(segment, host.size());
  if (begin == std::wstring::npos) return {};
  const size_t idBegin = begin + segment.size();
  size_t end = url.find_first_of(L"?#/", idBegin);
  if (end == std::wstring::npos) end = url.size();
  if (idBegin >= end) return {};
  for (size_t i = idBegin; i < end; ++i) {
    const wchar_t c = url[i];
    if (!((c >= L'a' && c <= L'z') || (c >= L'A' && c <= L'Z') ||
          (c >= L'0' && c <= L'9'))) {
      return {};
    }
  }
  return url.substr(begin, end - begin);
}

}  // namespace

void SpotifyWebViews::BeginInitialCloudPlaylistWait(ULONGLONG now) noexcept {
  if (now == 0) now = GetTickCount64();
  initialCloudPlaylistWaitStartedTick_ = now;
  initialCloudPlaylistReady_ = false;
  initialCloudPlaylistWriteTimeKnown_ = false;
  initialCloudPlaylistWriteTime_ = {};

  const fs::path path = userDataFolder_.parent_path() / kSpotifyCloudConfigFile;
  std::error_code error;
  const fs::file_time_type writeTime = fs::last_write_time(path, error);
  if (!error) {
    initialCloudPlaylistWriteTime_ = writeTime;
    initialCloudPlaylistWriteTimeKnown_ = true;
  }
}

bool SpotifyWebViews::InitialCloudPlaylistReady(ULONGLONG now) noexcept {
  if (initialCloudPlaylistReady_) return true;
  if (initialCloudPlaylistWaitStartedTick_ == 0) {
    BeginInitialCloudPlaylistWait(now);
  }
  if (now == 0) now = GetTickCount64();

  const fs::path path = userDataFolder_.parent_path() / kSpotifyCloudConfigFile;
  std::error_code error;
  const fs::file_time_type writeTime = fs::last_write_time(path, error);
  const bool fileAvailable = !error;
  const ULONGLONG elapsed = now - initialCloudPlaylistWaitStartedTick_;

  // CloudClient starts immediately after Renderer initialization. On a fresh
  // install, do not build the first Spotify cycle until that first sync has
  // produced device-config.json. With a coherent existing cache, give the
  // startup sync a short window to replace it if the cloud version changed.
  // The bounded fallback preserves offline startup instead of wedging Spotify.
  if (!initialCloudPlaylistWriteTimeKnown_) {
    initialCloudPlaylistReady_ = fileAvailable ||
        elapsed >= kSpotifyInitialCloudSyncFallbackMs;
  } else if (fileAvailable && writeTime != initialCloudPlaylistWriteTime_) {
    initialCloudPlaylistReady_ = true;
  } else if (fileAvailable && elapsed >= kSpotifyInitialCloudSyncSettleMs) {
    initialCloudPlaylistReady_ = true;
  } else if (elapsed >= kSpotifyInitialCloudSyncFallbackMs) {
    initialCloudPlaylistReady_ = true;
  }

  if (initialCloudPlaylistReady_) EnsureCloudPlaylistLoaded();
  return initialCloudPlaylistReady_;
}

void SpotifyWebViews::EnsureCloudPlaylistLoaded() noexcept {
  const fs::path path = userDataFolder_.parent_path() / kSpotifyCloudConfigFile;
  std::error_code timeError;
  const fs::file_time_type writeTime = fs::last_write_time(path, timeError);
  const bool fileAvailable = !timeError;

  if (cloudPlaylistLoaded_) {
    // CloudClient replaces this cache atomically. If the file is momentarily
    // unavailable during replacement, keep the last applied Spotify settings.
    if (!fileAvailable) return;
    if (cloudPlaylistWriteTimeKnown_ && writeTime == cloudPlaylistWriteTime_) {
      return;
    }
  }

  std::vector<RotationGroup> nextRotationGroups;
  std::wstring nextRotationFingerprint = kSpotifyFallbackRotationFingerprint;

  if (fileAvailable) {
    try {
      std::ifstream input(path, std::ios::binary);
      const std::string bytes((std::istreambuf_iterator<char>(input)), {});
      if (!bytes.empty()) {
        using winrt::Windows::Data::Json::JsonArray;
        using winrt::Windows::Data::Json::JsonObject;
        using winrt::Windows::Data::Json::JsonValueType;

        const JsonObject envelope = JsonObject::Parse(Utf8ToWide(bytes));
        const JsonObject root = envelope.GetNamedObject(L"config", JsonObject{});
        const JsonObject spotify = root.GetNamedObject(L"spotify", JsonObject{});

        const auto parseTrack = [](const JsonObject& object)
            -> std::optional<ManagedTrack> {
          try {
            const std::wstring url =
                object.GetNamedString(L"url", L"").c_str();
            const std::wstring path =
                ManagedSpotifyPathFromUrl(url, L"/track/");
            if (path.empty()) return std::nullopt;
            ManagedTrack track;
            track.title = object.GetNamedString(L"title", L"").c_str();
            track.url = url;
            track.path = path;
            const double durationMs = object.GetNamedNumber(L"durationMs", 0.0);
            if (std::isfinite(durationMs) && durationMs >= 1000.0 &&
                durationMs <= 24.0 * 60.0 * 60.0 * 1000.0) {
              track.durationMs = static_cast<ULONGLONG>(std::llround(durationMs));
            }
            return track;
          } catch (...) {
            return std::nullopt;
          }
        };

        try {
          const JsonArray rotation = spotify.GetNamedArray(L"rotation");
          std::vector<RotationGroup> groups;
          groups.reserve(
              std::min<size_t>(rotation.Size(), kSpotifyMaxRotationGroups));
          size_t maximumCycleTracks = 0;

          for (uint32_t groupIndex = 0;
               groupIndex < rotation.Size() &&
               groups.size() < kSpotifyMaxRotationGroups;
               ++groupIndex) {
            if (rotation.GetAt(groupIndex).ValueType() !=
                JsonValueType::Object) {
              continue;
            }
            const JsonObject source = rotation.GetObjectAt(groupIndex);
            const std::wstring mode =
                source.GetNamedString(L"mode", L"fixed").c_str();

            RotationGroup group;
            if (_wcsicmp(mode.c_str(), L"shuffle") == 0) {
              group.mode = RotationGroup::Mode::Shuffle;
            } else if (_wcsicmp(mode.c_str(), L"random") == 0) {
              group.mode = RotationGroup::Mode::Random;
            } else if (_wcsicmp(mode.c_str(), L"fixed") == 0) {
              group.mode = RotationGroup::Mode::Fixed;
            } else {
              continue;
            }

            const JsonArray tracks =
                source.GetNamedArray(L"tracks", JsonArray{});
            group.tracks.reserve(
                std::min<size_t>(tracks.Size(), kSpotifyMaxTracksPerGroup));
            for (uint32_t trackIndex = 0;
                 trackIndex < tracks.Size() &&
                 group.tracks.size() < kSpotifyMaxTracksPerGroup;
                 ++trackIndex) {
              if (tracks.GetAt(trackIndex).ValueType() !=
                  JsonValueType::Object) {
                continue;
              }
              if (auto track = parseTrack(tracks.GetObjectAt(trackIndex))) {
                const bool duplicate = std::any_of(
                    group.tracks.begin(), group.tracks.end(),
                    [&track](const ManagedTrack& existing) {
                      return existing.path == track->path;
                    });
                if (!duplicate) group.tracks.push_back(std::move(*track));
              }
            }

            const size_t configuredCandidateCount = group.tracks.size();
            if (configuredCandidateCount == 0) continue;

            if (group.mode == RotationGroup::Mode::Random) {
              double requested = source.GetNamedNumber(L"count", 1.0);
              if (!std::isfinite(requested)) requested = 1.0;
              requested = std::clamp(
                  requested, 0.0,
                  static_cast<double>(configuredCandidateCount));
              group.count = static_cast<size_t>(std::floor(requested));
              if (group.count == 0) continue;
              maximumCycleTracks += group.count;
            } else {
              group.count = configuredCandidateCount;
              maximumCycleTracks += configuredCandidateCount;
            }

            if (maximumCycleTracks > kSpotifyMaxTracksPerCycle) break;
            groups.push_back(std::move(group));
          }

          if (!groups.empty() &&
              maximumCycleTracks <= kSpotifyMaxTracksPerCycle) {
            nextRotationGroups = std::move(groups);
            nextRotationFingerprint = rotation.Stringify().c_str();
          }
        } catch (...) {
          // Invalid rotation deliberately falls back to the built-in cycle.
        }
      }
    } catch (...) {
      // A malformed synchronized file leaves the safe defaults active.
    }
  }

  const bool initialLoad = !cloudPlaylistLoaded_;
  const bool rotationChanged =
      initialLoad || nextRotationFingerprint != cloudRotationFingerprint_;

  cloudPlaylistLoaded_ = true;
  cloudPlaylistWriteTimeKnown_ = fileAvailable;
  if (fileAvailable) cloudPlaylistWriteTime_ = writeTime;

  if (!rotationChanged) return;
  cloudRotationGroups_ = std::move(nextRotationGroups);
  cloudRotationFingerprint_ = std::move(nextRotationFingerprint);
  ++cloudRotationRevision_;
  if (cloudRotationRevision_ == 0) cloudRotationRevision_ = 1;
}

}  // namespace hp
