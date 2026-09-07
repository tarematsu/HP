namespace hp {
namespace {

constexpr wchar_t kSpotifyBitterBlueUrl[] =
    L"https://open.spotify.com/track/5EjWZuODqEPQ9eq7XCmITh";
constexpr wchar_t kSpotifyBitterBluePath[] =
    L"/track/5EjWZuODqEPQ9eq7XCmITh";
constexpr wchar_t kSpotifyBitterBlueTitle[] = L"放課後BitterBlue";
constexpr wchar_t kSpotifyLonesomeRabbitUrl[] =
    L"https://open.spotify.com/track/6Vy6hCA2CZwZalGqaX6Sew";
constexpr wchar_t kSpotifyLonesomeRabbitPath[] =
    L"/track/6Vy6hCA2CZwZalGqaX6Sew";
constexpr wchar_t kSpotifyLonesomeRabbitTitle[] = L"lonesome rabbit";
constexpr wchar_t kSpotifyTalkAboutShowPath[] =
    L"/show/2ZQy2mlwQodabAILwZ02Ed";

const wchar_t* TimedSpotifyUrl(
    SpotifyWebViews::TimedSpotifyTarget target) noexcept {
  switch (target) {
    case SpotifyWebViews::TimedSpotifyTarget::BitterBlue:
      return kSpotifyBitterBlueUrl;
    case SpotifyWebViews::TimedSpotifyTarget::TalkAbout:
      return kSpotifyPodcastUrl;
    case SpotifyWebViews::TimedSpotifyTarget::LonesomeRabbit:
      return kSpotifyLonesomeRabbitUrl;
    case SpotifyWebViews::TimedSpotifyTarget::CatalogTrack:
    case SpotifyWebViews::TimedSpotifyTarget::None:
      return nullptr;
  }
  return nullptr;
}

}  // namespace

bool SpotifyWebViews::SlotMatchesTimedTarget(const Slot& slot) const noexcept {
  if (!slot.webview || slot.timedTarget == TimedSpotifyTarget::None) return false;
  LPWSTR rawSource = nullptr;
  if (FAILED(slot.webview->get_Source(&rawSource)) || !rawSource) return false;
  const std::wstring source(rawSource);
  CoTaskMemFree(rawSource);
  if (!IsSpotifyOpenSource(source)) return false;

  switch (slot.timedTarget) {
    case TimedSpotifyTarget::BitterBlue:
      return source.find(kSpotifyBitterBluePath) != std::wstring::npos;
    case TimedSpotifyTarget::TalkAbout:
      return source.find(kSpotifyTalkAboutShowPath) != std::wstring::npos ||
             source.find(L"/episode/") != std::wstring::npos;
    case TimedSpotifyTarget::LonesomeRabbit:
      return source.find(kSpotifyLonesomeRabbitPath) != std::wstring::npos;
    case TimedSpotifyTarget::CatalogTrack:
      // CatalogTrack is owned by spotify_recent_catalog.inc.
      return false;
    case TimedSpotifyTarget::None:
      return false;
  }
  return false;
}

void SpotifyWebViews::NavigateTimedSlot(Slot& slot) noexcept {
  if (!slot.webview || slot.timedTarget == TimedSpotifyTarget::CatalogTrack) {
    return;
  }
  const wchar_t* url = TimedSpotifyUrl(slot.timedTarget);
  if (!url) return;

  slot.lastModeNavigateTick = GetTickCount64();
  slot.unhealthyChecks = 0;
  slot.playing = false;
  SetSpotifyOutputMuted(slot.webview);
  PostSpotifyTargetDescriptorForSlot(slot);
  slot.webview->ExecuteScript(kSpotifyStaticStopPlaybackScript, nullptr);
  RecomputeForeground();
  const HRESULT result = slot.webview->Navigate(url);
  if (FAILED(result)) slot.lastModeNavigateTick = 0;
}

void SpotifyWebViews::ReconcileTimedSlot(Slot& slot) noexcept {
  if (!slot.hostWindow || !IsWindow(slot.hostWindow)) return;
  if (!slot.webview) {
    BeginControllerCreate(slot);
    return;
  }
  slot.controllerCreating = false;
  slot.controllerCreateTick = 0;

  if (SlotIsLoginPage(slot) || slot.timedTarget == TimedSpotifyTarget::None) {
    slot.unhealthyChecks = 0;
    return;
  }
  if (slot.timedTarget == TimedSpotifyTarget::CatalogTrack) return;

  if (!SlotMatchesTimedTarget(slot)) {
    const ULONGLONG now = GetTickCount64();
    if (slot.lastModeNavigateTick == 0 ||
        now - slot.lastModeNavigateTick >= kSpotifyRobustNavigateRetryMs) {
      NavigateTimedSlot(slot);
    }
    return;
  }

  slot.lastModeNavigateTick = 0;
  if (slot.reconcileInFlight) return;

  PostSpotifyTargetDescriptorForSlot(slot);
  const wchar_t* script = slot.timedTarget == TimedSpotifyTarget::TalkAbout
      ? kSpotifyStaticPodcastReconcileScript
      : kSpotifyStaticTrackReconcileScript;

  slot.reconcileInFlight = true;
  const TimedSpotifyTarget requestedTarget = slot.timedTarget;
  Slot* const target = &slot;
  const auto alive = alive_;
  const HRESULT started = slot.webview->ExecuteScript(
      script,
      Callback<ICoreWebView2ExecuteScriptCompletedHandler>(
          [this, alive, target, requestedTarget](
              HRESULT result, LPCWSTR json) -> HRESULT {
            if (!alive->load(std::memory_order_acquire)) return S_OK;
            target->reconcileInFlight = false;
            if (!started_ || requestedTarget != target->timedTarget) return S_OK;

            if (FAILED(result)) {
              target->playing = false;
              if (++target->unhealthyChecks >= kSpotifyRobustReloadThreshold) {
                NavigateTimedSlot(*target);
              } else {
                RecomputeForeground();
              }
              return S_OK;
            }

            if (requestedTarget == TimedSpotifyTarget::TalkAbout && json &&
                std::wstring_view(json) == L"\"completed\"") {
              target->podcastCompleted = true;
              target->timedTarget = TimedSpotifyTarget::None;
              target->timedCatalogIndex = kNoTimedCatalogIndex;
              target->playing = true;
              target->unhealthyChecks = 0;
              target->lastModeNavigateTick = 0;
              target->lastTimedReconcileTick = 0;
              RecomputeForeground();
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
              NavigateTimedSlot(*target);
            } else {
              RecomputeForeground();
            }
            return S_OK;
          }).Get());

  if (FAILED(started)) {
    slot.reconcileInFlight = false;
    slot.playing = false;
    if (++slot.unhealthyChecks >= kSpotifyRobustReloadThreshold) {
      NavigateTimedSlot(slot);
    } else {
      RecomputeForeground();
    }
  }
}

}  // namespace hp
