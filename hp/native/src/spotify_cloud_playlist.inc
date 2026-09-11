namespace hp {
namespace {

constexpr wchar_t kSpotifyCloudConfigFile[] = L"device-config.json";
constexpr double kSpotifyDefaultPodcastPlaybackRate = 3.0;
constexpr int kSpotifyMinPodcastIntervalMinutes = 15;
constexpr int kSpotifyMaxPodcastIntervalMinutes = 120;
constexpr size_t kSpotifyMaxRotationGroups = 32;
constexpr size_t kSpotifyMaxTracksPerGroup = 256;
constexpr size_t kSpotifyMaxTracksPerCycle = 512;
constexpr wchar_t kSpotifyFallbackRotationFingerprint[] = L"<fallback>";
constexpr wchar_t kSpotifyDefaultPodcastFingerprint[] = L"<default>";

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

void SpotifyWebViews::EnsureCloudPlaylistLoaded() noexcept {
  const fs::path path = userDataFolder_.parent_path() / kSpotifyCloudConfigFile;
  std::error_code timeError;
  const fs::file_time_type writeTime = fs::last_write_time(path, timeError);
  const bool fileAvailable = !timeError;

  if (cloudPlaylistLoaded_) {
    // CloudClient replaces this cache atomically. If the file is momentarily
    // unavailable during replacement, keep the last applied Spotify settings
    // instead of falling back and causing a spurious rotation revision.
    if (!fileAvailable) return;
    if (cloudPlaylistWriteTimeKnown_ && writeTime == cloudPlaylistWriteTime_) {
      return;
    }
  }

  std::vector<RotationGroup> nextRotationGroups;
  std::wstring nextPodcastUrl;
  std::wstring nextPodcastPath;
  std::wstring nextRotationFingerprint = kSpotifyFallbackRotationFingerprint;
  std::wstring nextPodcastFingerprint = kSpotifyDefaultPodcastFingerprint;
  ULONGLONG nextPodcastIntervalMs = kSpotifyPodcastIntervalMs;
  double nextPodcastPlaybackRate = kSpotifyDefaultPodcastPlaybackRate;

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
            group.includeTalkAbout =
                source.GetNamedBoolean(L"includeTalkAbout", false);

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
            if (group.tracks.empty()) continue;

            if (group.mode == RotationGroup::Mode::Random) {
              double requested = source.GetNamedNumber(L"count", 1.0);
              if (!std::isfinite(requested)) requested = 1.0;
              requested = std::clamp(
                  requested, 0.0, static_cast<double>(group.tracks.size()));
              group.count = static_cast<size_t>(std::floor(requested));
              if (group.count == 0) continue;
              maximumCycleTracks += group.count;
            } else {
              group.count = group.tracks.size();
              maximumCycleTracks += group.tracks.size();
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

        try {
          const JsonObject talkAbout = spotify.GetNamedObject(L"talkAbout");
          const std::wstring episodeUrl =
              talkAbout.GetNamedString(L"episodeUrl", L"").c_str();
          const std::wstring episodePath =
              ManagedSpotifyPathFromUrl(episodeUrl, L"/episode/");
          if (!episodePath.empty()) {
            nextPodcastUrl = episodeUrl;
            nextPodcastPath = episodePath;
          }

          double minutesValue =
              talkAbout.GetNamedNumber(L"intervalMinutes", 120.0);
          if (std::isfinite(minutesValue)) {
            minutesValue = std::clamp(
                minutesValue,
                static_cast<double>(kSpotifyMinPodcastIntervalMinutes),
                static_cast<double>(kSpotifyMaxPodcastIntervalMinutes));
            const int minutes = static_cast<int>(std::llround(minutesValue));
            nextPodcastIntervalMs =
                static_cast<ULONGLONG>(minutes) * 60ULL * 1000ULL;
          }

          const double rate = talkAbout.GetNamedNumber(
              L"playbackRate", kSpotifyDefaultPodcastPlaybackRate);
          if (std::isfinite(rate)) {
            nextPodcastPlaybackRate = std::clamp(rate, 0.5, 4.0);
          }
          nextPodcastFingerprint = talkAbout.Stringify().c_str();
        } catch (...) {
          // No valid direct episode URL means TALKABOUT waits for cloud sync.
        }
      }
    } catch (...) {
      // A malformed synchronized file leaves the safe defaults active.
    }
  }

  const bool initialLoad = !cloudPlaylistLoaded_;
  const bool rotationChanged =
      initialLoad || nextRotationFingerprint != cloudRotationFingerprint_;
  const bool podcastChanged =
      initialLoad || nextPodcastFingerprint != cloudPodcastFingerprint_;

  cloudPlaylistLoaded_ = true;
  cloudPlaylistWriteTimeKnown_ = fileAvailable;
  if (fileAvailable) cloudPlaylistWriteTime_ = writeTime;

  if (rotationChanged) {
    cloudRotationGroups_ = std::move(nextRotationGroups);
    cloudRotationFingerprint_ = std::move(nextRotationFingerprint);
    ++cloudRotationRevision_;
    if (cloudRotationRevision_ == 0) cloudRotationRevision_ = 1;
  }

  if (!podcastChanged) return;

  cloudPodcastUrl_ = std::move(nextPodcastUrl);
  cloudPodcastPath_ = std::move(nextPodcastPath);
  cloudPodcastFingerprint_ = std::move(nextPodcastFingerprint);
  podcastIntervalMs_ = nextPodcastIntervalMs;
  podcastPlaybackRate_ = nextPodcastPlaybackRate;

  // A shorter synchronized TALKABOUT interval takes effect immediately without
  // postponing an already-earlier deadline when the interval is lengthened.
  if (podcastScheduleLoaded_) {
    const ULONGLONG now = GetTickCount64();
    const int64_t wallNow = UnixMillis();
    const int64_t maxFuture =
        wallNow + static_cast<int64_t>(podcastIntervalMs_);
    bool dirty = false;
    for (Slot& slot : slots_) {
      if (slot.podcastDueUnixMs <= 0) continue;
      if (slot.podcastDueUnixMs > maxFuture) {
        slot.podcastDueUnixMs = maxFuture;
        dirty = true;
      }
      const int64_t remainingWallMs =
          std::max<int64_t>(0, slot.podcastDueUnixMs - wallNow);
      slot.podcastDueTick = now + static_cast<ULONGLONG>(
          std::min<int64_t>(remainingWallMs,
                            static_cast<int64_t>(podcastIntervalMs_)));
    }
    if (dirty) SavePodcastScheduleState();
  }
}

const wchar_t* SpotifyWebViews::SpotifyPodcastUrl() const noexcept {
  return cloudPodcastUrl_.c_str();
}

const wchar_t* SpotifyWebViews::SpotifyPodcastPath() const noexcept {
  return cloudPodcastPath_.c_str();
}

bool SpotifyWebViews::SpotifyPodcastTargetReady() const noexcept {
  return !cloudPodcastUrl_.empty() && !cloudPodcastPath_.empty();
}

ULONGLONG SpotifyWebViews::SpotifyPodcastIntervalMs() const noexcept {
  return podcastIntervalMs_;
}

double SpotifyWebViews::SpotifyPodcastPlaybackRate() const noexcept {
  return podcastPlaybackRate_;
}

}  // namespace hp
