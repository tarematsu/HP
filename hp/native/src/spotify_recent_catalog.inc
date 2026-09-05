namespace hp {
namespace {

struct SpotifyRecentCatalogTrack {
  const wchar_t* title;
  const wchar_t* url;
  const wchar_t* pagePath;
  const wchar_t* trackPath;
};

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
// Lonesome rabbit と固定Bの放課後BitterBlueを除いた候補。2026-09-06
// 時点で未発売の16th『愛MUST BE』は含めない。既発曲の再収録、
// Interlude、OFF VOCAL、Remixも対象外。
constexpr std::array<SpotifyRecentCatalogTrack, 35>
    kSpotifyRecentCatalogTracks = {{
    // 2025 11th: UDAGAWA GENERATION (7)
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

    // 2025 2nd Album: new song only (1)
    {L"Addiction",
     L"https://open.spotify.com/track/4HCPWhwMu93z1jnpxw5OGM",
     L"/track/4HCPWhwMu93z1jnpxw5OGM",
     L"/track/4HCPWhwMu93z1jnpxw5OGM"},

    // 2025 12th: Make or Break (7)
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

    // 2025 13th: Unhappy birthday構文 (7)
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

    // 2026 14th: The growing up train (7)
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

    // 2026 15th: Lonesome rabbit / What's "KAZOKU"? (Aを除く6)
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

const SpotifyRecentCatalogTrack* RecentTimedCatalogTrack(size_t value) noexcept {
  if (!IsRecentCatalogIndex(value)) return nullptr;
  const size_t index = DecodeRecentCatalogIndex(value);
  if (index >= kSpotifyRecentCatalogTracks.size()) return nullptr;
  return &kSpotifyRecentCatalogTracks[index];
}

std::wstring EscapeRecentScriptLiteral(std::wstring_view value) {
  std::wstring escaped;
  escaped.reserve(value.size() + 8);
  for (const wchar_t ch : value) {
    if (ch == L'\\' || ch == L'\'') escaped.push_back(L'\\');
    escaped.push_back(ch);
  }
  return escaped;
}

std::wstring BuildRecentTrackScript(const SpotifyRecentCatalogTrack& track) {
  const std::wstring pagePath = EscapeRecentScriptLiteral(track.pagePath);
  const std::wstring trackPath = EscapeRecentScriptLiteral(track.trackPath);
  const std::wstring title = EscapeRecentScriptLiteral(track.title);
  std::wstring script = LR"JS(
(() => {
  const pagePath = ')JS";
  script += pagePath;
  script += LR"JS(';
  const targetPath = ')JS";
  script += trackPath;
  script += LR"JS(';
  const targetTitle = ')JS";
  script += title;
  script += LR"JS('.toLowerCase();
  const normalize = value => (value || '').replace(/\s+/g, ' ').trim();
  const visible = element => {
    if (!element || element.disabled ||
        element.getAttribute('aria-disabled') === 'true') return false;
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' &&
           style.pointerEvents !== 'none' && rect.width > 0 && rect.height > 0;
  };
  const labelOf = element => normalize(
      (element && (element.getAttribute('aria-label') ||
                   element.getAttribute('title'))) || '').toLowerCase();
  const buttonShowsPlaying = button => {
    const label = labelOf(button);
    return label.includes('pause') || label.includes('一時停止');
  };
  const currentTrack = () => {
    const selectors = [
      '[data-testid="now-playing-widget"] a[href*="/track/"]',
      '[data-testid="context-item-link"][href*="/track/"]'
    ];
    for (const selector of selectors) {
      const link = document.querySelector(selector);
      if (!link) continue;
      try {
        const path = new URL(link.href, location.href).pathname;
        if (!path.startsWith('/track/')) continue;
        const text = normalize(link.textContent).toLowerCase();
        return { path, title: text };
      } catch (_) {}
    }
    const metadata = navigator.mediaSession && navigator.mediaSession.metadata;
    return {
      path: '',
      title: normalize(metadata && metadata.title).toLowerCase()
    };
  };
  const targetMatches = track => targetPath
      ? track.path === targetPath
      : track.title === targetTitle;
  const playerControl = () => {
    const primary = document.querySelector(
        'button[data-testid="control-button-playpause"]');
    if (visible(primary)) return primary;
    return Array.from(document.querySelectorAll('button, [role="button"]'))
        .find(button => {
          if (!visible(button)) return false;
          const label = labelOf(button);
          return label === 'play' || label === 'pause' ||
                 label === '再生' || label === '一時停止';
        }) || null;
  };
  const targetLink = () => Array.from(
      document.querySelectorAll('a[href*="/track/"]')).find(link => {
        try {
          const path = new URL(link.href, location.href).pathname;
          if (targetPath && path === targetPath) return true;
          return !targetPath &&
              normalize(link.textContent).toLowerCase() === targetTitle;
        } catch (_) { return false; }
      }) || null;
  const targetPlayButton = () => {
    const link = targetLink();
    if (link) {
      const row = link.closest(
          '[data-testid="tracklist-row"], [role="row"], li, [aria-rowindex]') ||
          link.parentElement?.parentElement;
      if (row) {
        const buttons = Array.from(row.querySelectorAll(
            'button[data-testid="play-button"], button, [role="button"]'));
        const button = buttons.find(candidate => {
          if (!visible(candidate)) return false;
          const label = labelOf(candidate);
          return label === 'play' || label === '再生' ||
                 label === 'pause' || label === '一時停止' ||
                 label.includes(targetTitle);
        });
        if (button) return button;
      }
    }
    return Array.from(document.querySelectorAll(
        'button[data-testid="play-button"]')).find(visible) || null;
  };
  const point = element => {
    if (!visible(element) || window.innerWidth <= 0 || window.innerHeight <= 0) {
      return null;
    }
    try { element.scrollIntoView({ block: 'center', inline: 'nearest' }); }
    catch (_) {}
    const rect = element.getBoundingClientRect();
    if (rect.bottom <= 0 || rect.right <= 0 ||
        rect.top >= window.innerHeight || rect.left >= window.innerWidth) {
      return null;
    }
    return [
      Math.max(0, Math.min(10000, Math.round(
          ((rect.left + rect.width / 2) / window.innerWidth) * 10000))),
      Math.max(0, Math.min(10000, Math.round(
          ((rect.top + rect.height / 2) / window.innerHeight) * 10000)))
    ];
  };
  const report = playing => {
    if (window.chrome && window.chrome.webview) {
      window.chrome.webview.postMessage(
          playing ? 'spotify:playing' : 'spotify:not-playing');
    }
  };

  if (location.hostname !== 'open.spotify.com' ||
      location.pathname !== pagePath) {
    report(false);
    return null;
  }

  const current = currentTrack();
  const control = playerControl();
  const button = targetPlayButton();
  if ((targetMatches(current) && buttonShowsPlaying(control)) ||
      buttonShowsPlaying(button)) {
    report(true);
    return true;
  }

  report(false);
  if (targetMatches(current) && visible(control)) return point(control);
  return point(button);
})()
)JS";
  return script;
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

  size_t index = 0;
  while (index < count) {
    const size_t encoded = EncodeRecentCatalogIndex(index);
    if (encoded != avoidIndex && encoded != secondAvoidIndex) return encoded;
    ++index;
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
  LPWSTR rawSource = nullptr;
  if (FAILED(slot.webview->get_Source(&rawSource)) || !rawSource) return false;
  const std::wstring source(rawSource);
  CoTaskMemFree(rawSource);
  return IsSpotifyOpenSource(source) &&
         source.find(track->pagePath) != std::wstring::npos;
}

void SpotifyWebViews::NavigateRecentTimedSlot(Slot& slot) noexcept {
  if (!slot.webview) return;
  const SpotifyRecentCatalogTrack* track =
      RecentTimedCatalogTrack(slot.timedCatalogIndex);
  if (!track) return;

  slot.lastModeNavigateTick = GetTickCount64();
  slot.unhealthyChecks = 0;
  slot.playing = false;
  SetSpotifyOutputMuted(slot.webview);
  slot.webview->ExecuteScript(kSpotifyClearLegacyEnsureScript, nullptr);
  RecomputeForeground();
  const HRESULT result = slot.webview->Navigate(track->url);
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

  const std::wstring script = BuildRecentTrackScript(*track);
  slot.reconcileInFlight = true;
  const size_t requestedCatalogIndex = slot.timedCatalogIndex;
  Slot* const target = &slot;
  const auto alive = alive_;
  const HRESULT started = slot.webview->ExecuteScript(
      script.c_str(),
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

}  // namespace hp
