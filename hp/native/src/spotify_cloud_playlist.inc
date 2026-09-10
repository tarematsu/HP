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

std::wstring ManagedSpotifyPathFromUrl(
    const std::wstring& url, std::wstring_view segment) {
  constexpr std::wstring_view host = L"https://open.spotify.com";
  if (!StartsWithInsensitive(url, host)) return {};
  const size_t begin = url.find(segment, host.size());
  if (begin == std::wstring::npos) return {};
  const size_t idBegin = begin + segment.size();
  size_t end = url.find_first_of(L"?#", idBegin);
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

    std::array<ManagedTrack, 5> nextFixed{};
    bool fixedValid = false;
    try {
      const auto a = parseTrack(spotify.GetNamedObject(L"aTrack"));
      const JsonArray shuffle = spotify.GetNamedArray(L"shuffleTracks");
      if (a && shuffle.Size() == 4) {
        nextFixed[0] = *a;
        fixedValid = true;
        for (uint32_t i = 0; i < 4; ++i) {
          if (shuffle.GetAt(i).ValueType() != JsonValueType::Object) {
            fixedValid = false;
            break;
          }
          const auto track = parseTrack(shuffle.GetObjectAt(i));
          if (!track) {
            fixedValid = false;
            break;
          }
          nextFixed[static_cast<size_t>(i) + 1] = *track;
        }
      }
    } catch (...) {
      fixedValid = false;
    }
    if (fixedValid) {
      cloudFixedTracks_ = std::move(nextFixed);
      cloudFixedTracksValid_ = true;
    }

    try {
      const JsonArray random = spotify.GetNamedArray(L"randomPool");
      std::vector<ManagedTrack> nextRandom;
      nextRandom.reserve(std::min<uint32_t>(random.Size(), 200));
      for (uint32_t i = 0; i < random.Size() && nextRandom.size() < 200; ++i) {
        if (random.GetAt(i).ValueType() != JsonValueType::Object) continue;
        if (auto track = parseTrack(random.GetObjectAt(i))) {
          const bool duplicate = std::any_of(
              nextRandom.begin(), nextRandom.end(),
              [&track](const ManagedTrack& existing) {
                return existing.path == track->path;
              });
          if (!duplicate) nextRandom.push_back(std::move(*track));
        }
      }
      if (!nextRandom.empty()) cloudRandomTracks_ = std::move(nextRandom);
    } catch (...) {
      // An absent/invalid pool keeps the built-in fallback catalog.
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
      // Podcast defaults remain active when this section is absent or malformed.
    }
  } catch (...) {
    // Cloud playlist is optional. Built-in defaults always remain usable.
  }
}

const SpotifyWebViews::ManagedTrack* SpotifyWebViews::ManagedFixedTrack(
    size_t index) const noexcept {
  if (!cloudFixedTracksValid_ || index >= cloudFixedTracks_.size()) return nullptr;
  return &cloudFixedTracks_[index];
}

const SpotifyWebViews::ManagedTrack* SpotifyWebViews::ManagedRandomTrack(
    size_t index) const noexcept {
  if (index >= cloudRandomTracks_.size()) return nullptr;
  return &cloudRandomTracks_[index];
}

size_t SpotifyWebViews::ActiveRandomTrackCount() const noexcept {
  return cloudRandomTracks_.empty() ? 0 : cloudRandomTracks_.size();
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