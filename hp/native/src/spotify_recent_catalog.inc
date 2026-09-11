namespace hp {
namespace {

struct SpotifyFallbackCatalogTrack {
  const wchar_t* title;
  const wchar_t* url;
  const wchar_t* path;
};

#include "spotify_fallback_catalog.inc"

constexpr std::array<SpotifyFallbackCatalogTrack, 5> kSpotifyBSlotTracks = {{
    {L"What's \"KAZOKU\"?", L"https://open.spotify.com/track/33liCluqUasE65nMv3KLLm", L"/track/33liCluqUasE65nMv3KLLm"},
    {L"コインランドリー", L"https://open.spotify.com/track/5QnQ7m9OxSoFeSPSz8grqX", L"/track/5QnQ7m9OxSoFeSPSz8grqX"},
    {L"We got your back", L"https://open.spotify.com/track/2ze5Hu3eRRe6HxJTfuZaA0", L"/track/2ze5Hu3eRRe6HxJTfuZaA0"},
    {L"各駅停車", L"https://open.spotify.com/track/2CMSkSwIfnNQR7bTNFFeB5", L"/track/2CMSkSwIfnNQR7bTNFFeB5"},
    {L"恵まれ過ぎて", L"https://open.spotify.com/track/2meBhRDzQpf0ltQH11HbWG", L"/track/2meBhRDzQpf0ltQH11HbWG"},
}};

bool IsSpotifyInstrumentalRotationTrack(std::wstring_view title) noexcept {
  return title == L"Overture" || title.rfind(L"Interlude #", 0) == 0;
}

bool IsSpotifyOffVocalRotationTrack(std::wstring_view title) noexcept {
  return title.find(L"OFF VOCAL") != std::wstring_view::npos;
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
  inlineTalkAboutRotation_ = false;

  // The managed cloud configuration historically exposes one fixed Lonesome
  // block plus one random catalog block. Preserve that cloud-managed catalog as
  // the source of truth, but assemble the requested seven positions natively:
  // A Lonesome / B five-song pool / C Overture+Interludes / D BitterBlue /
  // E-F short-song pool / G short-song pool + latest TALKABOUT. Every appended
  // path is unique inside a cycle.
  const RotationGroup* managedPool = nullptr;
  if (!cloudRotationGroups_.empty()) {
    const RotationGroup& first = cloudRotationGroups_.front();
    const bool managedLonesome =
        first.mode == RotationGroup::Mode::Fixed &&
        std::any_of(first.tracks.begin(), first.tracks.end(),
                    [](const ManagedTrack& track) {
                      return track.path == kSpotifyLonesomeRabbitPath;
                    });
    if (managedLonesome) {
      for (const RotationGroup& group : cloudRotationGroups_) {
        if (group.mode != RotationGroup::Mode::Random || group.count != 1 ||
            group.tracks.size() < 9) {
          continue;
        }
        const bool hasShortSong = std::any_of(
            group.tracks.begin(), group.tracks.end(),
            [](const ManagedTrack& track) {
              return !IsSpotifyInstrumentalRotationTrack(track.title) &&
                     !IsSpotifyOffVocalRotationTrack(track.title);
            });
        const bool hasInstrumental = std::any_of(
            group.tracks.begin(), group.tracks.end(),
            [](const ManagedTrack& track) {
              return IsSpotifyInstrumentalRotationTrack(track.title);
            });
        if (hasShortSong && hasInstrumental &&
            (!managedPool || group.tracks.size() > managedPool->tracks.size())) {
          managedPool = &group;
        }
      }
    }
  }

  if (managedPool) {
    inlineTalkAboutRotation_ = true;
    std::vector<std::wstring> usedPaths;
    usedPaths.reserve(7);

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

    const auto pickOne = [this, &appendUnique](
                             std::vector<ManagedTrack> candidates) {
      for (size_t remaining = candidates.size(); remaining > 1; --remaining) {
        const size_t swapIndex =
            static_cast<size_t>(NextTimedRandom() % remaining);
        std::swap(candidates[remaining - 1], candidates[swapIndex]);
      }
      for (ManagedTrack& candidate : candidates) {
        if (appendUnique(std::move(candidate))) return true;
      }
      return false;
    };

    // A: fixed Lonesome Rabbit.
    appendUnique({kSpotifyLonesomeRabbitTitle, kSpotifyLonesomeRabbitUrl,
                  kSpotifyLonesomeRabbitPath});

    // B: one shuffled selection from the five requested songs.
    std::vector<ManagedTrack> bCandidates;
    bCandidates.reserve(kSpotifyBSlotTracks.size());
    for (const auto& candidate : kSpotifyBSlotTracks) {
      bCandidates.push_back({candidate.title, candidate.url, candidate.path});
    }
    pickOne(std::move(bCandidates));

    // C: one shuffled selection from Overture and every Interlude available in
    // the synchronized managed catalog.
    std::vector<ManagedTrack> instrumentalCandidates;
    for (const ManagedTrack& track : managedPool->tracks) {
      if (IsSpotifyInstrumentalRotationTrack(track.title)) {
        instrumentalCandidates.push_back(track);
      }
    }
    pickOne(std::move(instrumentalCandidates));

    // D: fixed 放課後BitterBlue.
    appendUnique({kSpotifyBitterBlueTitle, kSpotifyBitterBlueUrl,
                  kSpotifyBitterBluePath});

    // E/F: independent shuffled selections from the <=3:30 Sakurazaka song
    // pool. Instrumental and OFF VOCAL entries live in the managed catalog too,
    // but are deliberately excluded from this song pool.
    std::vector<ManagedTrack> shortSongCandidates;
    for (const ManagedTrack& track : managedPool->tracks) {
      if (!IsSpotifyInstrumentalRotationTrack(track.title) &&
          !IsSpotifyOffVocalRotationTrack(track.title)) {
        shortSongCandidates.push_back(track);
      }
    }
    pickOne(shortSongCandidates);
    pickOne(shortSongCandidates);

    // G: the same short-song pool plus the cloud-resolved latest TALKABOUT
    // episode. The common used-path filter prevents a same-cycle song repeat.
    std::vector<ManagedTrack> gCandidates = shortSongCandidates;
    if (SpotifyPodcastTargetReady()) {
      gCandidates.push_back(
          {L"櫻坂46の「さ」Talk about", SpotifyPodcastUrl(),
           SpotifyPodcastPath()});
    }
    pickOne(std::move(gCandidates));

    if (slot.timedCycleTracks.size() == 7) return;

    // A malformed/incomplete managed catalog must not strand a slot. Fall back
    // to the generic cloud behavior below instead of publishing a partial cycle.
    slot.timedCycleTracks.clear();
    inlineTalkAboutRotation_ = false;
  }

  const auto appendGroup = [this, &slot](const RotationGroup& group) {
    if (group.tracks.empty()) return;
    if (group.mode == RotationGroup::Mode::Fixed) {
      slot.timedCycleTracks.insert(
          slot.timedCycleTracks.end(), group.tracks.begin(), group.tracks.end());
      return;
    }

    std::vector<size_t> order(group.tracks.size());
    for (size_t i = 0; i < order.size(); ++i) order[i] = i;
    for (size_t remaining = order.size(); remaining > 1; --remaining) {
      const size_t swapIndex = static_cast<size_t>(NextTimedRandom() % remaining);
      std::swap(order[remaining - 1], order[swapIndex]);
    }

    const size_t take = group.mode == RotationGroup::Mode::Random
        ? std::min(group.count, order.size())
        : order.size();
    for (size_t i = 0; i < take; ++i) {
      slot.timedCycleTracks.push_back(group.tracks[order[i]]);
    }
  };

  for (const RotationGroup& group : cloudRotationGroups_) appendGroup(group);
  if (!slot.timedCycleTracks.empty()) return;

  // Fail-safe preserves the previous A + shuffled B-E + one random F behavior
  // only when cloud rotation is missing or invalid.
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

SpotifyWebViews::MusicTargetDescriptor SpotifyWebViews::ResolveMusicTarget(
    const Slot& slot) const noexcept {
  if (slot.timedTarget != TimedSpotifyTarget::Music ||
      slot.timedRotationPosition >= slot.timedCycleTracks.size()) {
    return {};
  }
  const ManagedTrack& track = slot.timedCycleTracks[slot.timedRotationPosition];
  return {track.title.c_str(), track.url.c_str(), track.path.c_str()};
}

bool SpotifyWebViews::SlotMatchesMusicTarget(const Slot& slot) const noexcept {
  if (!slot.webview) return false;
  const MusicTargetDescriptor target = ResolveMusicTarget(slot);
  if (!target.path) return false;

  LPWSTR rawSource = nullptr;
  if (FAILED(slot.webview->get_Source(&rawSource)) || !rawSource) return false;
  const std::wstring source(rawSource);
  CoTaskMemFree(rawSource);
  return IsSpotifyOpenSource(source) && source.find(target.path) != std::wstring::npos;
}

void SpotifyWebViews::NavigateMusicTarget(Slot& slot) noexcept {
  if (!slot.webview) return;
  const MusicTargetDescriptor target = ResolveMusicTarget(slot);
  if (!target.url) return;

  slot.lastModeNavigateTick = GetTickCount64();
  SetSlotState(slot, SlotState::Navigating);
  SetSpotifyOutputMuted(slot.webview);
  PostSpotifyTargetDescriptorForSlot(slot);
  slot.webview->ExecuteScript(kSpotifyStaticStopPlaybackScript, nullptr);
  RecomputeForeground();
  const HRESULT result = slot.webview->Navigate(target.url);
  if (FAILED(result)) {
    slot.lastModeNavigateTick = 0;
    MarkSlotRecovering(slot, GetTickCount64());
  }
  ArmRobustScheduler();
}

void SpotifyWebViews::ReconcileMusicTarget(Slot& slot) noexcept {
  if (!slot.hostWindow || !IsWindow(slot.hostWindow)) return;
  if (!slot.webview) {
    BeginControllerCreate(slot);
    return;
  }
  slot.controllerCreating = false;
  slot.controllerCreateTick = 0;

  if (SlotIsLoginPage(slot) || !ResolveMusicTarget(slot).url) return;

  if (!SlotMatchesMusicTarget(slot)) {
    const ULONGLONG now = GetTickCount64();
    MarkSlotRecovering(slot, now);
    if (slot.lastModeNavigateTick == 0 ||
        now - slot.lastModeNavigateTick >= kSpotifyRobustNavigateRetryMs) {
      NavigateMusicTarget(slot);
    }
    return;
  }

  slot.lastModeNavigateTick = 0;
  if (slot.reconcileInFlight) return;

  PostSpotifyTargetDescriptorForSlot(slot);
  ++slot.reconcileRequestGeneration;
  if (slot.reconcileRequestGeneration == 0) ++slot.reconcileRequestGeneration;
  const ULONGLONG reconcileRequestGeneration = slot.reconcileRequestGeneration;
  slot.reconcileInFlight = true;
  slot.reconcileStartedTick = GetTickCount64();
  const ULONGLONG requestedGeneration = slot.targetGeneration;
  Slot* const target = &slot;
  ComPtr<ICoreWebView2> requestedView = slot.webview;
  const auto alive = alive_;
  const HRESULT started = requestedView->ExecuteScript(
      kSpotifyStaticTrackReconcileScript,
      Callback<ICoreWebView2ExecuteScriptCompletedHandler>(
          [this, alive, target, requestedView, requestedGeneration,
           reconcileRequestGeneration](HRESULT result, LPCWSTR json) -> HRESULT {
            if (!alive->load(std::memory_order_acquire)) return S_OK;
            if (target->reconcileRequestGeneration != reconcileRequestGeneration ||
                target->webview.Get() != requestedView.Get()) {
              return S_OK;
            }
            target->reconcileInFlight = false;
            target->reconcileStartedTick = 0;
            if (!started_ || requestedGeneration != target->targetGeneration ||
                !ResolveMusicTarget(*target).url) {
              return S_OK;
            }

            const ULONGLONG now = GetTickCount64();
            if (FAILED(result)) {
              MarkSlotRecovering(*target, now);
              if (ShouldRenavigateUnhealthySlot(*target, now)) {
                NavigateMusicTarget(*target);
              } else {
                RecomputeForeground();
                ArmRobustScheduler();
              }
              return S_OK;
            }

            if (json && std::wstring_view(json) == L"true") {
              SetSlotState(*target, SlotState::Playing);
              RecomputeForeground();
              ArmRobustScheduler();
              return S_OK;
            }

            int x = 0;
            int y = 0;
            if (ParseNormalizedPoint(json, &x, &y)) {
              if (target->unhealthySinceTick == 0) target->unhealthySinceTick = now;
              if (ShouldRenavigateUnhealthySlot(*target, now)) {
                NavigateMusicTarget(*target);
              } else {
                ClickSlotNormalizedPoint(*target, x, y);
                ArmRobustScheduler();
              }
              return S_OK;
            }

            MarkSlotRecovering(*target, now);
            if (ShouldRenavigateUnhealthySlot(*target, now)) {
              NavigateMusicTarget(*target);
            } else {
              RecomputeForeground();
              ArmRobustScheduler();
            }
            return S_OK;
          }).Get());

  if (FAILED(started)) {
    if (slot.reconcileRequestGeneration == reconcileRequestGeneration &&
        slot.webview.Get() == requestedView.Get()) {
      slot.reconcileInFlight = false;
      slot.reconcileStartedTick = 0;
    }
    const ULONGLONG now = GetTickCount64();
    MarkSlotRecovering(slot, now);
    if (ShouldRenavigateUnhealthySlot(slot, now)) {
      NavigateMusicTarget(slot);
    } else {
      RecomputeForeground();
      ArmRobustScheduler();
    }
  }
}

void SpotifyWebViews::NavigateActiveTimedSlot(Slot& slot) noexcept {
  if (slot.timedTarget == TimedSpotifyTarget::TalkAbout) {
    NavigatePodcastSlot(slot);
    return;
  }
  NavigateMusicTarget(slot);
}

void SpotifyWebViews::ReconcileActiveTimedSlot(Slot& slot) noexcept {
  if (slot.timedTarget == TimedSpotifyTarget::TalkAbout) {
    ReconcilePodcastSlot(slot);
    return;
  }
  ReconcileMusicTarget(slot);
}

void SpotifyWebViews::PostSpotifyTargetDescriptorForSlot(Slot& slot) noexcept {
  if (!slot.webview) return;

  std::wstring_view pagePath;
  std::wstring_view trackPath;
  std::wstring_view title;
  std::wstring_view kind = L"none";
  std::wstring playbackRate;

  if (slot.timedTarget == TimedSpotifyTarget::TalkAbout) {
    pagePath = SpotifyPodcastPath();
    kind = L"podcast";
    playbackRate = std::to_wstring(SpotifyPodcastPlaybackRate());
  } else {
    const MusicTargetDescriptor target = ResolveMusicTarget(slot);
    if (target.path) {
      pagePath = target.path;
      trackPath = target.path;
      title = target.title ? target.title : L"";
      kind = L"music";
    }
  }

  std::wstring message = L"spotify:target";
  const auto appendField = [&message](std::wstring_view value) {
    message.push_back(kSpotifyMessageSeparator);
    message.append(value);
  };
  appendField(pagePath);
  appendField(trackPath);
  appendField(title);
  appendField(kind);
  appendField(playbackRate);
  slot.webview->PostWebMessageAsString(message.c_str());

  std::wstring generationMessage = L"spotify:generation";
  generationMessage.push_back(kSpotifyMessageSeparator);
  generationMessage.append(std::to_wstring(slot.targetGeneration));
  slot.webview->PostWebMessageAsString(generationMessage.c_str());
}

}  // namespace hp
