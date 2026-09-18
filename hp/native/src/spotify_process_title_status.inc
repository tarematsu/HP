namespace hp {
namespace {

constexpr ULONGLONG kSpotifyProcessTitlePollMs = 60ULL * 1000ULL;
constexpr ULONGLONG kSpotifyProcessTitlePollPhaseMs =
    kSpotifyProcessTitlePollMs / kSpotifyActiveAccountCount;
static_assert(kSpotifyActiveAccountCount == 5);
static_assert(kSpotifyProcessTitlePollPhaseMs == 12ULL * 1000ULL);

// Status is intentionally independent from the managed/queued target. The
// playback observer stores a title only after a real media element is confirmed
// playing. The one-minute poll reads that cheap cache first, then may read the
// browser media-session title only while the observer still owns confirmed
// playback. The live player DOM remains the final startup/recovery fallback.
constexpr wchar_t kSpotifyNowPlayingDomScript[] = LR"JS(
(() => {
  if (location.hostname !== 'open.spotify.com') return { title: '' };

  const clean = value => String(value || '').replace(/\s+/g, ' ').trim()
      .replace(/^(?:now playing|currently playing|再生中)\s*[:：-]?\s*/i, '');
  const runtime = window.__homePanelSpotifyMediaObserverRuntime;
  const state = runtime && runtime.state;
  const cached = clean(state && state.actualTrackTitle);
  if (cached) return { title: cached };

  // Background Spotify hosts are visually clipped to 1x1. In that state the
  // Now Playing React surface can stay stale until Monitor C/D/E is selected.
  // MediaSession is therefore accepted only when our observer has already
  // confirmed and owns a real, currently-playing HTMLMediaElement. This keeps
  // status independent from the planned/native target while removing the
  // foreground-render dependency.
  const ownedMedia = state && state.targetMedia;
  const currentTime = Number(ownedMedia && ownedMedia.currentTime);
  const confirmedPlayback = !!(
      state && state.startPosted && ownedMedia &&
      !ownedMedia.paused && !ownedMedia.ended &&
      Number.isFinite(currentTime) && currentTime > 0);
  if (confirmedPlayback) {
    const metadata = navigator.mediaSession && navigator.mediaSession.metadata;
    const mediaSessionTitle = clean(metadata && metadata.title);
    if (mediaSessionTitle) return { title: mediaSessionTitle };
  }

  const roots = [];
  const addRoot = element => {
    if (element && !roots.includes(element)) roots.push(element);
  };
  addRoot(document.querySelector('[data-testid="now-playing-widget"]'));
  addRoot(document.querySelector('[data-testid="now-playing-bar"]'));
  addRoot(document.querySelector('[data-testid="main-view-player-bar"]'));
  addRoot(document.querySelector('[data-testid="bottom-bar"]'));
  addRoot(document.querySelector('footer[class*="now-playing"]'));
  addRoot(document.querySelector('footer'));

  const titleOf = element => {
    if (!element) return '';
    for (const value of [
      element.textContent,
      element.getAttribute?.('title'),
      element.getAttribute?.('aria-label')
    ]) {
      const title = clean(value);
      if (title) return title;
    }
    return '';
  };

  // Keep selectors scoped to the actual bottom-player roots. Never inspect the
  // main track page, queue, playlist, or native target descriptor.
  for (const root of roots) {
    for (const selector of [
      '[data-testid="context-item-info-title"]',
      'a[data-testid="context-item-link"][href*="/track/"]',
      'a[href*="/track/"]',
      '[data-testid="nowplaying-track-link"]',
      '[data-testid="now-playing-widget-title"] a',
      '.track-info__name a',
      'a[aria-label*="Now playing:" i]',
      '.now-playing .track-name',
      '[class*="track-name"]',
      '.player-track-info__name'
    ]) {
      let element = null;
      try { element = root.matches?.(selector) ? root : root.querySelector(selector); }
      catch (_) { continue; }
      const title = titleOf(element);
      if (title) return { title };
    }
  }
  return { title: '' };
})()
)JS";

std::wstring_view TrimSpotifyNowPlayingText(std::wstring_view value) noexcept {
  while (!value.empty() && iswspace(value.front())) value.remove_prefix(1);
  while (!value.empty() && iswspace(value.back())) value.remove_suffix(1);
  return value;
}

bool TrySpotifyNowPlayingTrackFromJson(
    LPCWSTR json, std::wstring* track) noexcept {
  if (!json || !*json || !track) return false;
  try {
    const auto root = winrt::Windows::Data::Json::JsonObject::Parse(json);
    std::wstring title(root.GetNamedString(L"title", L"").c_str());
    const std::wstring_view trimmed = TrimSpotifyNowPlayingText(title);
    track->assign(trimmed);
    return true;
  } catch (...) {
    return false;
  }
}

}  // namespace

void SpotifyWebViews::RefreshProcessTitleStatus(
    Slot& slot, ICoreWebView2* webview) noexcept {
  if (!webview || slot.webview.Get() != webview) return;

  Slot* const target = &slot;
  const auto alive = alive_;
  ComPtr<ICoreWebView2> requestedView = slot.webview;
  const HRESULT started = requestedView->ExecuteScript(
      kSpotifyNowPlayingDomScript,
      Callback<ICoreWebView2ExecuteScriptCompletedHandler>(
          [alive, target, requestedView](HRESULT result, LPCWSTR json) -> HRESULT {
            if (!alive->load(std::memory_order_acquire) || FAILED(result) ||
                target->webview.Get() != requestedView.Get()) {
              return S_OK;
            }

            std::wstring display;
            if (!TrySpotifyNowPlayingTrackFromJson(json, &display)) return S_OK;
            const bool observed = !display.empty();
            if (target->processTitleObserved == observed &&
                target->processTrackDisplay == display) {
              return S_OK;
            }

            target->processTrackDisplay = std::move(display);
            target->processTitleObserved = observed;
            if (observed) {
              GetLocalTime(&target->processTitleObservedAt);
            } else {
              target->processTitleObservedAt = {};
            }
            InvalidateSpotifyStatusForHost(target->hostWindow);
            return S_OK;
          }).Get());
  (void)started;
}

void SpotifyWebViews::PollProcessTitleStatus(ULONGLONG now) noexcept {
  size_t selected = slots_.size();
  for (size_t i = 0; i < slots_.size(); ++i) {
    const Slot& slot = slots_[i];
    if (!slot.webview) continue;
    if (slot.nextProcessTitlePollTick != 0 &&
        now < slot.nextProcessTitlePollTick) {
      continue;
    }
    selected = i;
    break;
  }
  if (selected >= slots_.size()) return;

  // Never execute multiple status probes in one scheduler pass. If Windows was
  // asleep or the UI thread was stalled long enough for multiple phases to
  // expire, spread overdue reads back out at the account phase interval.
  ULONGLONG catchUpDelay = kSpotifyProcessTitlePollPhaseMs;
  for (size_t i = selected + 1; i < slots_.size(); ++i) {
    Slot& slot = slots_[i];
    if (!slot.webview) continue;
    if (slot.nextProcessTitlePollTick == 0 ||
        now >= slot.nextProcessTitlePollTick) {
      slot.nextProcessTitlePollTick = now + catchUpDelay;
      catchUpDelay += kSpotifyProcessTitlePollPhaseMs;
    }
  }

  Slot& slot = slots_[selected];
  RefreshProcessTitleStatus(slot, slot.webview.Get());
  slot.nextProcessTitlePollTick = now + kSpotifyProcessTitlePollMs;
}

}  // namespace hp
