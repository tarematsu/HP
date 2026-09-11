namespace hp {
namespace {

struct SpotifyFallbackCatalogTrack {
  const wchar_t* title;
  const wchar_t* url;
  const wchar_t* path;
};

#include "spotify_fallback_catalog.inc"

ULONGLONG MixSpotifyRotationSeed(ULONGLONG value) noexcept {
  value += 0x9E3779B97F4A7C15ULL;
  value = (value ^ (value >> 30)) * 0xBF58476D1CE4E5B9ULL;
  value = (value ^ (value >> 27)) * 0x94D049BB133111EBULL;
  return value ^ (value >> 31);
}

ULONGLONG NextSpotifySeededRandom(ULONGLONG& state) noexcept {
  state = MixSpotifyRotationSeed(state);
  return state;
}

}  // namespace

ULONGLONG SpotifyWebViews::NextTimedRandom() noexcept {
  if (timedRandomState_ == 0) {
    LARGE_INTEGER counter{};
    QueryPerformanceCounter(&counter);
    timedRandomState_ =
        GetTickCount64() ^ static_cast<ULONGLONG>(counter.QuadPart) ^
        static_cast<ULONGLONG>(reinterpret_cast<ULONG_PTR>(this));
    if (timedRandomState_ == 0) timedRandomState_ = 0x9E3779B97F4A7C15ULL;
  }

  ULONGLONG x = timedRandomState_;
  x ^= x >> 12;
  x ^= x << 25;
  x ^= x >> 27;
  timedRandomState_ = x;
  return x * 2685821657736338717ULL;
}

void SpotifyWebViews::PrepareTimedRotationCycle(Slot& slot) noexcept {
  slot.timedCycleTracks.clear();

  // E/F/G intentionally share the same short-song pool, so keep one common
  // used-path set across all groups. A song selected earlier in the same cycle
  // is skipped and the group continues through its shuffled candidates.
  std::vector<std::wstring> usedPaths;
  usedPaths.reserve(kSpotifyMaxTracksPerCycle);
  const auto appendUnique = [&slot, &usedPaths](ManagedTrack track) {
    if (track.path.empty() ||
        std::find(usedPaths.begin(), usedPaths.end(), track.path) !=
            usedPaths.end()) {
      return false;
    }
    usedPaths.push_back(track.path);
    slot.timedCycleTracks.push_back(std::move(track));
    return true;
  };

  size_t groupIndex = 0;
  const auto appendGroup =
      [this, &slot, &appendUnique, &groupIndex](const RotationGroup& group) {
    const size_t currentGroupIndex = groupIndex++;
    std::vector<ManagedTrack> candidates = group.tracks;
    if (group.includeTalkAbout && SpotifyPodcastTargetReady()) {
      candidates.push_back(
          {L"櫻坂46の「さ」Talk about", SpotifyPodcastUrl(),
           SpotifyPodcastPath()});
    }
    if (candidates.empty()) return;

    const size_t take = group.mode == RotationGroup::Mode::Random
        ? std::min(group.count, candidates.size())
        : candidates.size();

    if (group.mode != RotationGroup::Mode::Fixed) {
      // Every account derives the same base permutation for the same app
      // session, cloud revision, cycle, and rotation group. slot.index is
      // intentionally excluded from this seed; per-window diversity comes from
      // the lane rotation below, so no extra polling, DOM work, or network work
      // is needed to coordinate the six WebViews.
      ULONGLONG shuffleState = MixSpotifyRotationSeed(
          scheduleStartTick_ ^
          (cloudRotationRevision_ * 0x9E3779B97F4A7C15ULL) ^
          ((slot.timedRotationCycle + 1ULL) * 0xBF58476D1CE4E5B9ULL) ^
          ((static_cast<ULONGLONG>(currentGroupIndex) + 1ULL) *
           0x94D049BB133111EBULL) ^
          static_cast<ULONGLONG>(reinterpret_cast<ULONG_PTR>(this)));
      for (size_t remaining = candidates.size(); remaining > 1; --remaining) {
        const size_t swapIndex = static_cast<size_t>(
            NextSpotifySeededRandom(shuffleState) % remaining);
        std::swap(candidates[remaining - 1], candidates[swapIndex]);
      }

      // Give each account a different lane through that shared permutation.
      // Random groups reserve count-sized lanes, which makes their selected
      // blocks disjoint whenever the pool is large enough. Shuffle groups use
      // one-step lanes so their first/current song differs across windows while
      // retaining every candidate in each account's cycle. If a pool contains
      // fewer than six candidates, the modulo wrap gives the minimum possible
      // duplication rather than adding retries or cross-window coordination.
      const size_t laneWidth = group.mode == RotationGroup::Mode::Random
          ? std::max<size_t>(1, take)
          : 1;
      const size_t laneStart =
          (currentGroupIndex * kAccountCount + slot.index * laneWidth) %
          candidates.size();
      if (laneStart != 0) {
        std::rotate(
            candidates.begin(), candidates.begin() + laneStart,
            candidates.end());
      }
    }

    size_t appended = 0;
    for (ManagedTrack& candidate : candidates) {
      if (!appendUnique(std::move(candidate))) continue;
      ++appended;
      if (appended >= take) break;
    }
  };

  for (const RotationGroup& group : cloudRotationGroups_) appendGroup(group);
  if (!slot.timedCycleTracks.empty()) return;

  // Fail-safe preserves the former six-song behavior only when cloud rotation
  // is missing or invalid.
  slot.timedCycleTracks.push_back(
      {kSpotifyLonesomeRabbitTitle, kSpotifyLonesomeRabbitUrl,
       kSpotifyLonesomeRabbitPath});
  std::array<ManagedTrack, 4> middle = {{
      {kSpotifyBitterBlueTitle, kSpotifyBitterBlueUrl, kSpotifyBitterBluePath},
      {kSpotifyMonshirochoTitle, kSpotifyMonshirochoUrl, kSpotifyMonshirochoPath},
      {kSpotifyMunenTitle, kSpotifyMunenUrl, kSpotifyMunenPath},
      {kSpotifyOnMyWayTitle, kSpotifyOnMyWayUrl, kSpotifyOnMyWayPath},
  }};
  for (size_t remaining = middle.size(); remaining > 1; --remaining) {
    const size_t swapIndex = static_cast<size_t>(NextTimedRandom() % remaining);
    std::swap(middle[remaining - 1], middle[swapIndex]);
  }
  slot.timedCycleTracks.insert(
      slot.timedCycleTracks.end(), middle.begin(), middle.end());
  const auto& randomTrack = kSpotifyFallbackCatalogTracks[
      static_cast<size_t>(NextTimedRandom() % kSpotifyFallbackCatalogTracks.size())];
  slot.timedCycleTracks.push_back(
      {randomTrack.title, randomTrack.url, randomTrack.path});
}

}  // namespace hp
