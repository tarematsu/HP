namespace hp {
namespace {

constexpr wchar_t kSpotifyCloudConfigFile[] = L"device-config.json";
constexpr wchar_t kSpotifyDefaultPodcastUrl[] =
    L"https://open.spotify.com/show/2ZQy2mlwQodabAILwZ02Ed";
constexpr wchar_t kSpotifyDefaultPodcastPath[] =
    L"/show/2ZQy2mlwQodabAILwZ02Ed";
constexpr double kSpotifyDefaultPodcastPlaybackRate = 3.0;
constexpr int kSpotifyMinPodcastIntervalMinutes = 15;
constexpr int kSpotifyMaxPodcastIntervalMinutes = 120;
constexpr size_t kSpotifyMaxRotationGroups = 32;
constexpr size_t kSpotifyMaxTracksPerGroup = 256;
constexpr size_t kSpotifyMaxTracksPerCycle = 512;

std::wstring ManagedSpotifyPathFromUrl(
    const std::wstring& url, std::wstring_view segment) {
  constexpr std::wstring_view host = L"https://open.spotify.com";
  if (!StartsWithInsensitive(url, host)) return {};
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
  if (cloudPlaylistLoaded_) return;
  cloudPlaylistLoaded_ = true;

  try {
    const fs::path path = userDataFolder_.parent_path() / kSpotifyCloudConfigFile;
    std::ifstream input(path, std::ios::binary);
    if (!input) return;
    const std::string bytes((std::istreambuf_iterator<char>(input)), {});
    if (bytes.empty()) return;

    using winrt::Windows::Data::Json::JsonArray;
    using winrt::Windows::Data::Json::JsonObject;
    using winrt::Windows::Data::Json::JsonValueType;

    const JsonObject envelope = JsonObject::Parse(Utf8ToWide(bytes));
    const JsonObject root = envelope.GetNamedObject(L"config", JsonObject{});
    const JsonObject spotify = root.GetNamedObject(L"spotify", JsonObject{});
    if (spotify.Size() == 0) return;

    const auto parseTrack = [](const JsonObject& object)
        -> std::optional<ManagedTrack> {
      try {
        const std::wstring url = object.GetNamedString(L"url", L"").c_str();
        const std::wstring path = ManagedSpotifyPathFromUrl(url, L"/track/");
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
      groups.reserve(std::min<size_t>(rotation.Size(), kSpotifyMaxRotationGroups));
      size_t maximumCycleTracks = 0;

      for (uint32_t groupIndex = 0;
           groupIndex < rotation.Size() && groups.size() < kSpotifyMaxRotationGroups;
           ++groupIndex) {
        if (rotation.GetAt(groupIndex).ValueType() != JsonValueType::Object) continue;
        const JsonObject source = rotation.GetObjectAt(groupIndex);
        const std::wstring mode = source.GetNamedString(L"mode", L"fixed").c_str();

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

        const JsonArray tracks = source.GetNamedArray(L"tracks", JsonArray{});
        group.tracks.reserve(
            std::min<size_t>(tracks.Size(), kSpotifyMaxTracksPerGroup));
        for (uint32_t trackIndex = 0;
             trackIndex < tracks.Size() &&
             group.tracks.size() < kSpotifyMaxTracksPerGroup;
             ++trackIndex) {
          if (tracks.GetAt(trackIndex).ValueType() != JsonValueType::Object) continue;
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
          group.count = std::clamp<size_t>(
              static_cast<size_t>(std::max(0.0, std::floor(requested))),
              size_t{0}, group.tracks.size());
          if (group.count == 0) continue;
          maximumCycleTracks += group.count;
        } else {
          group.count = group.tracks.size();
          maximumCycleTracks += group.tracks.size();
        }

        if (maximumCycleTracks > kSpotifyMaxTracksPerCycle) break;
        groups.push_back(std::move(group));
      }

      if (!groups.empty() && maximumCycleTracks <= kSpotifyMaxTracksPerCycle) {
        cloudRotationGroups_ = std::move(groups);
      }
    } catch (...) {
      // Missing/invalid rotation leaves the built-in sequence active.
    }

    try {
      const JsonObject talkAbout = spotify.GetNamedObject(L"talkAbout");
      const std::wstring url = talkAbout.GetNamedString(L"url", L"").c_str();
      const std::wstring showPath = ManagedSpotifyPathFromUrl(url, L"/show/");
      if (!showPath.empty()) {
        cloudPodcastUrl_ = url;
        cloudPodcastPath_ = showPath;
      }

      const double minutesValue =
          talkAbout.GetNamedNumber(L"intervalMinutes", 120.0);
      if (std::isfinite(minutesValue)) {
        const int minutes = std::clamp(
            static_cast<int>(std::llround(minutesValue)),
            kSpotifyMinPodcastIntervalMinutes,
            kSpotifyMaxPodcastIntervalMinutes);
        podcastIntervalMs_ = static_cast<ULONGLONG>(minutes) * 60ULL * 1000ULL;
      }

      const double rate = talkAbout.GetNamedNumber(
          L"playbackRate", kSpotifyDefaultPodcastPlaybackRate);
      if (std::isfinite(rate)) {
        podcastPlaybackRate_ = std::clamp(rate, 0.5, 4.0);
      }
    } catch (...) {
      // TALKABOUT defaults remain active when the section is absent/malformed.
    }
  } catch (...) {
    // Cloud playlist is optional. Built-in defaults always remain usable.
  }
}

const wchar_t* SpotifyWebViews::SpotifyPodcastUrl() const noexcept {
  return cloudPodcastUrl_.empty() ? kSpotifyDefaultPodcastUrl
                                  : cloudPodcastUrl_.c_str();
}

const wchar_t* SpotifyWebViews::SpotifyPodcastPath() const noexcept {
  return cloudPodcastPath_.empty() ? kSpotifyDefaultPodcastPath
                                   : cloudPodcastPath_.c_str();
}

ULONGLONG SpotifyWebViews::SpotifyPodcastIntervalMs() const noexcept {
  return podcastIntervalMs_;
}

double SpotifyWebViews::SpotifyPodcastPlaybackRate() const noexcept {
  return podcastPlaybackRate_;
}

}  // namespace hp