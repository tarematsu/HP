namespace hp {
namespace {

struct SpotifyRecentCatalogTrack {
  const wchar_t* title;
  const wchar_t* url;
  const wchar_t* path;
};

constexpr size_t kSpotifyRecentCatalogTag =
    size_t{1} << (sizeof(size_t) * 8U - 1U);
constexpr size_t kSpotifyRecentCatalogMask = ~kSpotifyRecentCatalogTag;

// One source of truth: every candidate carries its title and direct Track URL
// together, so adding/reordering tracks cannot desynchronize a parallel route
// table. Fixed A/C songs are intentionally excluded.
constexpr std::array<SpotifyRecentCatalogTrack, 35>
    kSpotifyRecentCatalogTracks = {{
    {L"UDAGAWA GENERATION", L"https://open.spotify.com/track/4ljk3qMzdU81kWzxcNix3F", L"/track/4ljk3qMzdU81kWzxcNix3F"},
    {L"Nightmare症候群", L"https://open.spotify.com/track/2hi8kIoKC8tRMDajdkoYFL", L"/track/2hi8kIoKC8tRMDajdkoYFL"},
    {L"Nothing special", L"https://open.spotify.com/track/2kiCcs4rC55nlHQ1djMTt6", L"/track/2kiCcs4rC55nlHQ1djMTt6"},
    {L"紋白蝶が確か飛んでた", L"https://open.spotify.com/track/6VIY7OFy8g5ZyLSgQEi8lV", L"/track/6VIY7OFy8g5ZyLSgQEi8lV"},
    {L"行かないで", L"https://open.spotify.com/track/3HdmFZGqZLNiCAfiNj4N84", L"/track/3HdmFZGqZLNiCAfiNj4N84"},
    {L"ULTRAVIOLET", L"https://open.spotify.com/track/145bvRRC27wMYn9GNtTg57", L"/track/145bvRRC27wMYn9GNtTg57"},
    {L"やるしかないじゃん", L"https://open.spotify.com/track/6GF0ZgT8wlksWrlLTfGmlU", L"/track/6GF0ZgT8wlksWrlLTfGmlU"},
    {L"Addiction", L"https://open.spotify.com/track/4HCPWhwMu93z1jnpxw5OGM", L"/track/4HCPWhwMu93z1jnpxw5OGM"},
    {L"Make or Break", L"https://open.spotify.com/track/7vvZ1QHTdkoEXBiOBdxdIo", L"/track/7vvZ1QHTdkoEXBiOBdxdIo"},
    {L"死んだふり", L"https://open.spotify.com/track/6QmAwjzLQy6SjUyvGzSCG4", L"/track/6QmAwjzLQy6SjUyvGzSCG4"},
    {L"港区パセリ", L"https://open.spotify.com/track/3SOOYBTDQBUe9vkavji2ZI", L"/track/3SOOYBTDQBUe9vkavji2ZI"},
    {L"恋愛無双", L"https://open.spotify.com/track/5vRGSkQiKlJudkJ2vUKIOe", L"/track/5vRGSkQiKlJudkJ2vUKIOe"},
    {L"真夏の大統領", L"https://open.spotify.com/track/4YUoggoqC3KIxts61kmlqw", L"/track/4YUoggoqC3KIxts61kmlqw"},
    {L"君のことを想いながら", L"https://open.spotify.com/track/6ZOaQShLJdbZYvPoi1xOdE", L"/track/6ZOaQShLJdbZYvPoi1xOdE"},
    {L"ノンアルコール", L"https://open.spotify.com/track/0yv01vKbOmS1UMS9XyN5ar", L"/track/0yv01vKbOmS1UMS9XyN5ar"},
    {L"Unhappy birthday構文", L"https://open.spotify.com/track/6O3XAkrjMG1T4x8jvdpbrp", L"/track/6O3XAkrjMG1T4x8jvdpbrp"},
    {L"Alter ego", L"https://open.spotify.com/track/4J2JsdELLCewlR7kISsw70", L"/track/4J2JsdELLCewlR7kISsw70"},
    {L"木枯らしは泣かない", L"https://open.spotify.com/track/6jxiPZV3Aopxbi33i09uFQ", L"/track/6jxiPZV3Aopxbi33i09uFQ"},
    {L"青空が見えるまで", L"https://open.spotify.com/track/12YgUwcZKUCnYWccet8qJq", L"/track/12YgUwcZKUCnYWccet8qJq"},
    {L"I will be", L"https://open.spotify.com/track/4AZXBU2rt8yCcEA1pttXLB", L"/track/4AZXBU2rt8yCcEA1pttXLB"},
    {L"Buddies (English Version)", L"https://open.spotify.com/track/6ncW1pJ5bHOum76AL2P08a", L"/track/6ncW1pJ5bHOum76AL2P08a"},
    {L"夜空で一番輝いてる星の名前を僕は知らない", L"https://open.spotify.com/track/6whOTYjcMh396LLbqig8jq", L"/track/6whOTYjcMh396LLbqig8jq"},
    {L"The growing up train", L"https://open.spotify.com/track/49cxVtrML7Xo63UFaaJrUR", L"/track/49cxVtrML7Xo63UFaaJrUR"},
    {L"光源", L"https://open.spotify.com/track/2MPm0NrgPoMr6ee7je9afe", L"/track/2MPm0NrgPoMr6ee7je9afe"},
    {L"ドライフルーツ", L"https://open.spotify.com/track/5DrxCKjopmd7UL1pJWqBHK", L"/track/5DrxCKjopmd7UL1pJWqBHK"},
    {L"キスが苦い", L"https://open.spotify.com/track/4PaLKbIU8NvguxcrjMvHXh", L"/track/4PaLKbIU8NvguxcrjMvHXh"},
    {L"くらげらしく", L"https://open.spotify.com/track/6J8Vaiow1E75EQs9RnMfZp", L"/track/6J8Vaiow1E75EQs9RnMfZp"},
    {L"Sunny side up", L"https://open.spotify.com/track/5xUQGRuP4LPk4ESl1xbmFs", L"/track/5xUQGRuP4LPk4ESl1xbmFs"},
    {L"僕は向いてない", L"https://open.spotify.com/track/11KKagWroMV5UXbK50hZxZ", L"/track/11KKagWroMV5UXbK50hZxZ"},
    {L"What's \"KAZOKU\"?", L"https://open.spotify.com/track/33liCluqUasE65nMv3KLLm", L"/track/33liCluqUasE65nMv3KLLm"},
    {L"コインランドリー", L"https://open.spotify.com/track/5QnQ7m9OxSoFeSPSz8grqX", L"/track/5QnQ7m9OxSoFeSPSz8grqX"},
    {L"We got your back", L"https://open.spotify.com/track/2ze5Hu3eRRe6HxJTfuZaA0", L"/track/2ze5Hu3eRRe6HxJTfuZaA0"},
    {L"狼たちよ", L"https://open.spotify.com/track/4IfRFec7SNKOWw1HzpiqHQ", L"/track/4IfRFec7SNKOWw1HzpiqHQ"},
    {L"各駅停車", L"https://open.spotify.com/track/2CMSkSwIfnNQR7bTNFFeB5", L"/track/2CMSkSwIfnNQR7bTNFFeB5"},
    {L"恵まれ過ぎて", L"https://open.spotify.com/track/2meBhRDzQpf0ltQH11HbWG", L"/track/2meBhRDzQpf0ltQH11HbWG"},
}};

static_assert(kSpotifyRecentCatalogTracks.size() == 35);

bool IsRecentCatalogIndex(size_t value) noexcept {
  return value != SpotifyWebViews::kNoTimedCatalogIndex &&
         (value & kSpotifyRecentCatalogTag) != 0;
}

size_t EncodeRecentCatalogIndex(size_t index) noexcept {
  return kSpotifyRecentCatalogTag | index;
}

size_t DecodeRecentCatalogIndex(size_t value) noexcept {
  return value & kSpotifyRecentCatalogMask;
}

const SpotifyRecentCatalogTrack* RecentTimedCatalogTrack(size_t value) noexcept {
  if (!IsRecentCatalogIndex(value)) return nullptr;
  const size_t index = DecodeRecentCatalogIndex(value);
  if (index >= kSpotifyRecentCatalogTracks.size()) return nullptr;
  return &kSpotifyRecentCatalogTracks[index];
}

}  // namespace

size_t SpotifyWebViews::PickRecentCatalogIndex(
    size_t avoidIndex, size_t secondAvoidIndex) noexcept {
  if (timedRandomState_ == 0) {
    LARGE_INTEGER counter{};
    QueryPerformanceCounter(&counter);
    timedRandomState_ =
        GetTickCount64() ^ static_cast<ULONGLONG>(counter.QuadPart) ^
        static_cast<ULONGLONG>(reinterpret_cast<ULONG_PTR>(this));
    if (timedRandomState_ == 0) {
      timedRandomState_ = 0x9E3779B97F4A7C15ULL;
    }
  }

  const size_t count = kSpotifyRecentCatalogTracks.size();
  for (unsigned attempt = 0; attempt < 8; ++attempt) {
    ULONGLONG x = timedRandomState_;
    x ^= x >> 12;
    x ^= x << 25;
    x ^= x >> 27;
    timedRandomState_ = x;
    const size_t index = static_cast<size_t>(
        (x * 2685821657736338717ULL) % count);
    const size_t encoded = EncodeRecentCatalogIndex(index);
    if (encoded != avoidIndex && encoded != secondAvoidIndex) return encoded;
  }

  for (size_t index = 0; index < count; ++index) {
    const size_t encoded = EncodeRecentCatalogIndex(index);
    if (encoded != avoidIndex && encoded != secondAvoidIndex) return encoded;
  }
  return kNoTimedCatalogIndex;
}

void SpotifyWebViews::EnsureRecentRandomPair(
    ULONGLONG rotationCycle, size_t avoidIndex) noexcept {
  const bool valid =
      IsRecentCatalogIndex(timedRandomCIndex_) &&
      IsRecentCatalogIndex(timedRandomDIndex_) &&
      timedRandomCIndex_ != timedRandomDIndex_ &&
      timedRandomCIndex_ != avoidIndex &&
      timedRandomDIndex_ != avoidIndex;
  if (timedRandomPairCycle_ == rotationCycle && valid) return;

  timedRandomCIndex_ =
      PickRecentCatalogIndex(avoidIndex, kNoTimedCatalogIndex);
  timedRandomDIndex_ =
      PickRecentCatalogIndex(timedRandomCIndex_, avoidIndex);
  timedRandomPairCycle_ = rotationCycle;
}

SpotifyWebViews::MusicTargetDescriptor SpotifyWebViews::ResolveMusicTarget(
    const Slot& slot) const noexcept {
  switch (slot.timedTarget) {
    case TimedSpotifyTarget::BitterBlue:
      return {kSpotifyBitterBlueTitle, kSpotifyBitterBlueUrl,
              kSpotifyBitterBluePath};
    case TimedSpotifyTarget::LonesomeRabbit:
      return {kSpotifyLonesomeRabbitTitle, kSpotifyLonesomeRabbitUrl,
              kSpotifyLonesomeRabbitPath};
    case TimedSpotifyTarget::CatalogTrack: {
      const SpotifyRecentCatalogTrack* track =
          RecentTimedCatalogTrack(slot.timedCatalogIndex);
      return track ? MusicTargetDescriptor{track->title, track->url, track->path}
                   : MusicTargetDescriptor{};
    }
    case TimedSpotifyTarget::TalkAbout:
    case TimedSpotifyTarget::None:
      return {};
  }
  return {};
}

bool SpotifyWebViews::SlotMatchesMusicTarget(const Slot& slot) const noexcept {
  if (!slot.webview) return false;
  const MusicTargetDescriptor target = ResolveMusicTarget(slot);
  if (!target.path) return false;

  LPWSTR rawSource = nullptr;
  if (FAILED(slot.webview->get_Source(&rawSource)) || !rawSource) return false;
  const std::wstring source(rawSource);
  CoTaskMemFree(rawSource);
  return IsSpotifyOpenSource(source) &&
         source.find(target.path) != std::wstring::npos;
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

  if (slot.timedTarget == TimedSpotifyTarget::TalkAbout) {
    pagePath = kSpotifyTalkAboutShowPath;
    kind = L"podcast";
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
  slot.webview->PostWebMessageAsString(message.c_str());

  // The target is published first so the page bootstrap immediately pauses the
  // old queue. The generation follows in the same native turn and is attached to
  // all observer events from the new target.
  std::wstring generationMessage = L"spotify:generation";
  generationMessage.push_back(kSpotifyMessageSeparator);
  generationMessage.append(std::to_wstring(slot.targetGeneration));
  slot.webview->PostWebMessageAsString(generationMessage.c_str());
}

}  // namespace hp