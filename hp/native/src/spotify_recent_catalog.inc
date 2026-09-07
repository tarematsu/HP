namespace hp {
namespace {

struct SpotifyRecentCatalogTrack {
  const wchar_t* title;
  const wchar_t* url;
  const wchar_t* pagePath;
  const wchar_t* trackPath;
};

#include "spotify_recent_direct_routes.inc"

constexpr size_t kSpotifyRecentCatalogTag =
    size_t{1} << (sizeof(size_t) * 8U - 1U);
constexpr size_t kSpotifyRecentCatalogMask = ~kSpotifyRecentCatalogTag;

constexpr wchar_t kSpotifyMakeOrBreakAlbumUrl[] =
    L"https://open.spotify.com/album/3teo9NiJLwhorFf3EE9WCh";
constexpr wchar_t kSpotifyMakeOrBreakAlbumPath[] =
    L"/album/3teo9NiJLwhorFf3EE9WCh";
constexpr wchar_t kSpotifyUnhappyBirthdayAlbumUrl[] =
    L"https://open.spotify.com/album/19SC6o3wULkC8QIKV0YKIb";
constexpr wchar_t kSpotifyUnhappyBirthdayAlbumPath[] =
    L"/album/19SC6o3wULkC8QIKV0YKIb";
constexpr wchar_t kSpotifyGrowingUpTrainAlbumUrl[] =
    L"https://open.spotify.com/album/5beJvSa1ZMvGtChLMkT60i";
constexpr wchar_t kSpotifyGrowingUpTrainAlbumPath[] =
    L"/album/5beJvSa1ZMvGtChLMkT60i";
constexpr wchar_t kSpotifyLonesomeKazokuAlbumUrl[] =
    L"https://open.spotify.com/album/04gmidhz5KYYOEqfTJXNmE";
constexpr wchar_t kSpotifyLonesomeKazokuAlbumPath[] =
    L"/album/04gmidhz5KYYOEqfTJXNmE";

// 2025-2026 に新規リリースされた櫻坂46の通常歌唱曲から、固定Aの
// Lonesome rabbit と固定Cの放課後BitterBlueを除いた候補。可変値は
// JavaScriptへ埋め込まず、WebView2 messageで静的スクリプトへ渡す。
constexpr std::array<SpotifyRecentCatalogTrack, 35>
    kSpotifyRecentCatalogTracks = {{
    {L"UDAGAWA GENERATION",
     L"https://open.spotify.com/track/4ljk3qMzdU81kWzxcNix3F",
     L"/track/4ljk3qMzdU81kWzxcNix3F",
     L"/track/4ljk3qMzdU81kWzxcNix3F"},
    {L"Nightmare症候群",
     L"https://open.spotify.com/track/2hi8kIoKC8tRMDajdkoYFL",
     L"/track/2hi8kIoKC8tRMDajdkoYFL",
     L"/track/2hi8kIoKC8tRMDajdkoYFL"},
    {L"Nothing special",
     L"https://open.spotify.com/track/2kiCcs4rC55nlHQ1djMTt6",
     L"/track/2kiCcs4rC55nlHQ1djMTt6",
     L"/track/2kiCcs4rC55nlHQ1djMTt6"},
    {L"紋白蝶が確か飛んでた",
     L"https://open.spotify.com/track/6VIY7OFy8g5ZyLSgQEi8lV",
     L"/track/6VIY7OFy8g5ZyLSgQEi8lV",
     L"/track/6VIY7OFy8g5ZyLSgQEi8lV"},
    {L"行かないで",
     L"https://open.spotify.com/track/3HdmFZGqZLNiCAfiNj4N84",
     L"/track/3HdmFZGqZLNiCAfiNj4N84",
     L"/track/3HdmFZGqZLNiCAfiNj4N84"},
    {L"ULTRAVIOLET",
     L"https://open.spotify.com/track/145bvRRC27wMYn9GNtTg57",
     L"/track/145bvRRC27wMYn9GNtTg57",
     L"/track/145bvRRC27wMYn9GNtTg57"},
    {L"やるしかないじゃん",
     L"https://open.spotify.com/track/6GF0ZgT8wlksWrlLTfGmlU",
     L"/track/6GF0ZgT8wlksWrlLTfGmlU",
     L"/track/6GF0ZgT8wlksWrlLTfGmlU"},
    {L"Addiction",
     L"https://open.spotify.com/track/4HCPWhwMu93z1jnpxw5OGM",
     L"/track/4HCPWhwMu93z1jnpxw5OGM",
     L"/track/4HCPWhwMu93z1jnpxw5OGM"},
    {L"Make or Break", kSpotifyMakeOrBreakAlbumUrl,
     kSpotifyMakeOrBreakAlbumPath, L""},
    {L"死んだふり", kSpotifyMakeOrBreakAlbumUrl,
     kSpotifyMakeOrBreakAlbumPath, L""},
    {L"港区パセリ", kSpotifyMakeOrBreakAlbumUrl,
     kSpotifyMakeOrBreakAlbumPath, L""},
    {L"恋愛無双", kSpotifyMakeOrBreakAlbumUrl,
     kSpotifyMakeOrBreakAlbumPath, L""},
    {L"真夏の大統領", kSpotifyMakeOrBreakAlbumUrl,
     kSpotifyMakeOrBreakAlbumPath, L""},
    {L"君のことを想いながら", kSpotifyMakeOrBreakAlbumUrl,
     kSpotifyMakeOrBreakAlbumPath, L""},
    {L"ノンアルコール", kSpotifyMakeOrBreakAlbumUrl,
     kSpotifyMakeOrBreakAlbumPath, L""},
    {L"Unhappy birthday構文", kSpotifyUnhappyBirthdayAlbumUrl,
     kSpotifyUnhappyBirthdayAlbumPath, L""},
    {L"Alter ego", kSpotifyUnhappyBirthdayAlbumUrl,
     kSpotifyUnhappyBirthdayAlbumPath, L""},
    {L"木枯らしは泣かない", kSpotifyUnhappyBirthdayAlbumUrl,
     kSpotifyUnhappyBirthdayAlbumPath, L""},
    {L"青空が見えるまで", kSpotifyUnhappyBirthdayAlbumUrl,
     kSpotifyUnhappyBirthdayAlbumPath, L""},
    {L"I will be", kSpotifyUnhappyBirthdayAlbumUrl,
     kSpotifyUnhappyBirthdayAlbumPath, L""},
    {L"Buddies (English Version)", kSpotifyUnhappyBirthdayAlbumUrl,
     kSpotifyUnhappyBirthdayAlbumPath, L""},
    {L"夜空で一番輝いてる星の名前を僕は知らない",
     kSpotifyUnhappyBirthdayAlbumUrl, kSpotifyUnhappyBirthdayAlbumPath, L""},
    {L"The growing up train", kSpotifyGrowingUpTrainAlbumUrl,
     kSpotifyGrowingUpTrainAlbumPath, L""},
    {L"光源", kSpotifyGrowingUpTrainAlbumUrl,
     kSpotifyGrowingUpTrainAlbumPath, L""},
    {L"ドライフルーツ", kSpotifyGrowingUpTrainAlbumUrl,
     kSpotifyGrowingUpTrainAlbumPath, L""},
    {L"キスが苦い", kSpotifyGrowingUpTrainAlbumUrl,
     kSpotifyGrowingUpTrainAlbumPath, L""},
    {L"くらげらしく", kSpotifyGrowingUpTrainAlbumUrl,
     kSpotifyGrowingUpTrainAlbumPath, L""},
    {L"Sunny side up", kSpotifyGrowingUpTrainAlbumUrl,
     kSpotifyGrowingUpTrainAlbumPath, L""},
    {L"僕は向いてない", kSpotifyGrowingUpTrainAlbumUrl,
     kSpotifyGrowingUpTrainAlbumPath, L""},
    {L"What's \"KAZOKU\"?", kSpotifyLonesomeKazokuAlbumUrl,
     kSpotifyLonesomeKazokuAlbumPath, L""},
    {L"コインランドリー", kSpotifyLonesomeKazokuAlbumUrl,
     kSpotifyLonesomeKazokuAlbumPath, L""},
    {L"We got your back", kSpotifyLonesomeKazokuAlbumUrl,
     kSpotifyLonesomeKazokuAlbumPath, L""},
    {L"狼たちよ", kSpotifyLonesomeKazokuAlbumUrl,
     kSpotifyLonesomeKazokuAlbumPath, L""},
    {L"各駅停車", kSpotifyLonesomeKazokuAlbumUrl,
     kSpotifyLonesomeKazokuAlbumPath, L""},
    {L"恵まれ過ぎて", kSpotifyLonesomeKazokuAlbumUrl,
     kSpotifyLonesomeKazokuAlbumPath, L""},
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

const SpotifyRecentDirectRoute* RecentTimedCatalogDirectRoute(
    size_t value) noexcept {
  if (!IsRecentCatalogIndex(value)) return nullptr;
  const size_t index = DecodeRecentCatalogIndex(value);
  if (index >= kSpotifyRecentDirectRoutes.size()) return nullptr;
  const SpotifyRecentDirectRoute& route = kSpotifyRecentDirectRoutes[index];
  if (!route.url || !route.path) return nullptr;
  return &route;
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

bool SpotifyWebViews::SlotMatchesRecentTimedTarget(
    const Slot& slot) const noexcept {
  if (!slot.webview || slot.timedTarget != TimedSpotifyTarget::CatalogTrack) {
    return false;
  }
  const SpotifyRecentCatalogTrack* track =
      RecentTimedCatalogTrack(slot.timedCatalogIndex);
  if (!track) return false;
  const SpotifyRecentDirectRoute* route =
      RecentTimedCatalogDirectRoute(slot.timedCatalogIndex);
  const wchar_t* pagePath = route ? route->path : track->pagePath;
  LPWSTR rawSource = nullptr;
  if (FAILED(slot.webview->get_Source(&rawSource)) || !rawSource) return false;
  const std::wstring source(rawSource);
  CoTaskMemFree(rawSource);
  return IsSpotifyOpenSource(source) &&
         source.find(pagePath) != std::wstring::npos;
}

void SpotifyWebViews::NavigateRecentTimedSlot(Slot& slot) noexcept {
  if (!slot.webview) return;
  const SpotifyRecentCatalogTrack* track =
      RecentTimedCatalogTrack(slot.timedCatalogIndex);
  if (!track) return;
  const SpotifyRecentDirectRoute* route =
      RecentTimedCatalogDirectRoute(slot.timedCatalogIndex);
  const wchar_t* url = route ? route->url : track->url;

  slot.lastModeNavigateTick = GetTickCount64();
  slot.unhealthyChecks = 0;
  slot.playing = false;
  SetSpotifyOutputMuted(slot.webview);
  RecomputeForeground();
  const HRESULT result = slot.webview->Navigate(url);
  if (FAILED(result)) slot.lastModeNavigateTick = 0;
}

void SpotifyWebViews::ReconcileRecentTimedSlot(Slot& slot) noexcept {
  if (!slot.hostWindow || !IsWindow(slot.hostWindow)) return;
  if (!slot.webview) {
    BeginControllerCreate(slot);
    return;
  }
  slot.controllerCreating = false;
  slot.controllerCreateTick = 0;

  if (SlotIsLoginPage(slot) ||
      slot.timedTarget != TimedSpotifyTarget::CatalogTrack) {
    slot.unhealthyChecks = 0;
    return;
  }

  const SpotifyRecentCatalogTrack* track =
      RecentTimedCatalogTrack(slot.timedCatalogIndex);
  if (!track) return;

  if (!SlotMatchesRecentTimedTarget(slot)) {
    const ULONGLONG now = GetTickCount64();
    if (slot.lastModeNavigateTick == 0 ||
        now - slot.lastModeNavigateTick >= kSpotifyRobustNavigateRetryMs) {
      NavigateRecentTimedSlot(slot);
    }
    return;
  }

  slot.lastModeNavigateTick = 0;
  if (slot.reconcileInFlight) return;

  PostSpotifyTargetDescriptorForSlot(slot);
  slot.reconcileInFlight = true;
  const size_t requestedCatalogIndex = slot.timedCatalogIndex;
  Slot* const target = &slot;
  const auto alive = alive_;
  const HRESULT started = slot.webview->ExecuteScript(
      kSpotifyStaticTrackReconcileScript,
      Callback<ICoreWebView2ExecuteScriptCompletedHandler>(
          [this, alive, target, requestedCatalogIndex](
              HRESULT result, LPCWSTR json) -> HRESULT {
            if (!alive->load(std::memory_order_acquire)) return S_OK;
            target->reconcileInFlight = false;
            if (!started_ ||
                target->timedTarget != TimedSpotifyTarget::CatalogTrack ||
                requestedCatalogIndex != target->timedCatalogIndex) {
              return S_OK;
            }

            if (FAILED(result)) {
              target->playing = false;
              if (++target->unhealthyChecks >= kSpotifyRobustReloadThreshold) {
                NavigateRecentTimedSlot(*target);
              } else {
                RecomputeForeground();
              }
              return S_OK;
            }

            if (json && std::wstring_view(json) == L"true") {
              target->playing = true;
              target->unhealthyChecks = 0;
              RecomputeForeground();
              return S_OK;
            }

            int x = 0;
            int y = 0;
            const bool hasPoint = ParseNormalizedPoint(json, &x, &y);
            target->playing = false;
            if (hasPoint) {
              target->unhealthyChecks = 0;
              RecomputeForeground();
              ClickSlotNormalizedPoint(*target, x, y);
              return S_OK;
            }

            if (++target->unhealthyChecks >= kSpotifyRobustReloadThreshold) {
              NavigateRecentTimedSlot(*target);
            } else {
              RecomputeForeground();
            }
            return S_OK;
          }).Get());

  if (FAILED(started)) {
    slot.reconcileInFlight = false;
    slot.playing = false;
    if (++slot.unhealthyChecks >= kSpotifyRobustReloadThreshold) {
      NavigateRecentTimedSlot(slot);
    } else {
      RecomputeForeground();
    }
  }
}

void SpotifyWebViews::NavigateActiveTimedSlot(Slot& slot) noexcept {
  if (slot.timedTarget == TimedSpotifyTarget::CatalogTrack &&
      IsRecentCatalogIndex(slot.timedCatalogIndex)) {
    NavigateRecentTimedSlot(slot);
    return;
  }
  NavigateTimedSlot(slot);
}

void SpotifyWebViews::ReconcileActiveTimedSlot(Slot& slot) noexcept {
  if (slot.timedTarget == TimedSpotifyTarget::CatalogTrack &&
      IsRecentCatalogIndex(slot.timedCatalogIndex)) {
    ReconcileRecentTimedSlot(slot);
    return;
  }
  ReconcileTimedSlot(slot);
}

void SpotifyWebViews::PostSpotifyTargetDescriptorForSlot(Slot& slot) noexcept {
  if (!slot.webview) return;

  std::wstring_view pagePath;
  std::wstring_view trackPath;
  std::wstring_view title;
  std::wstring_view kind = L"none";

  switch (slot.timedTarget) {
    case TimedSpotifyTarget::BitterBlue:
      pagePath = kSpotifyBitterBluePath;
      trackPath = kSpotifyBitterBluePath;
      title = kSpotifyBitterBlueTitle;
      kind = L"music";
      break;
    case TimedSpotifyTarget::TalkAbout:
      pagePath = kSpotifyTalkAboutShowPath;
      kind = L"podcast";
      break;
    case TimedSpotifyTarget::LonesomeRabbit:
      pagePath = kSpotifyLonesomeRabbitPath;
      title = kSpotifyLonesomeRabbitTitle;
      kind = L"music";
      break;
    case TimedSpotifyTarget::CatalogTrack: {
      const SpotifyRecentCatalogTrack* track =
          RecentTimedCatalogTrack(slot.timedCatalogIndex);
      if (track) {
        const SpotifyRecentDirectRoute* route =
            RecentTimedCatalogDirectRoute(slot.timedCatalogIndex);
        pagePath = route ? route->path : track->pagePath;
        trackPath = route ? route->path : track->trackPath;
        title = track->title;
        kind = L"music";
      }
      break;
    }
    case TimedSpotifyTarget::None:
      break;
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
}

}  // namespace hp