namespace hp {
namespace {

struct SpotifyFallbackCatalogTrack {
  const wchar_t* title;
  const wchar_t* url;
  const wchar_t* path;
};

#include "spotify_fallback_catalog.inc"

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

  // A track/episode path may appear in more than one cloud group (E/F/G share
  // the same short-song pool). Keep one common used set so every position in a
  // cycle is unique while each random group still samples independently from
  // its remaining eligible candidates.
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

  const auto appendGroup = [this, &appendUnique](const RotationGroup& group) {
    std::vector<ManagedTrack> candidates = group.tracks;
    if (group.includeTalkAbout) {
      inlineTalkAboutRotation_ = true;
      if (SpotifyPodcastTargetReady()) {
        candidates.push_back(
            {L"櫻坂46の「さ」Talk about", SpotifyPodcastUrl(),
             SpotifyPodcastPath()});
      }
    }
    if (candidates.empty()) return;

    if (group.mode != RotationGroup::Mode::Fixed) {
      for (size_t remaining = candidates.size(); remaining > 1; --remaining) {
        const size_t swapIndex =
            static_cast<size_t>(NextTimedRandom() % remaining);
        std::swap(candidates[remaining - 1], candidates[swapIndex]);
      }
    }

    const size_t take = group.mode == RotationGroup::Mode::Random
        ? std::min(group.count, candidates.size())
        : candidates.size();
    size_t appended = 0;
    for (ManagedTrack& candidate : candidates) {
      if (!appendUnique(std::move(candidate))) continue;
      ++appended;
      if (appended >= take) break;
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
