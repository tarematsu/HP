// TVer ad boundary handling. The established TVer scripts live in
// renderer_panels.cpp; patch them at runtime so the very large raw string does
// not grow and hit MSVC's string-literal limit.
namespace {
constexpr wchar_t kNativeMediaTverAdDetectorSnippet[] = LR"JS(
  const isTverAdvertisementActive = (video, state) => {
    const overlapsVideo = element => {
      if (!video || !isDisplayed(element)) return false;
      const markerRect = element.getBoundingClientRect();
      const videoRect = video.getBoundingClientRect();
      return markerRect.right > videoRect.left && markerRect.left < videoRect.right &&
             markerRect.bottom > videoRect.top && markerRect.top < videoRect.bottom;
    };
    const selectors = [
      '[aria-label*="広告"]', '[title*="広告"]',
      '[aria-label*="CM"]', '[title*="CM"]',
      '[data-testid*="ad"]', '[data-testid*="Ad"]',
      '[class*="advert"]', '[class*="Advert"]',
      '[class*="commercial"]', '[class*="Commercial"]',
      '[class*="ad-"]', '[class*="ad_"]', '[class*="Ad-"]',
      '[id*="advert"]', '[id*="Advert"]',
      '[id*="commercial"]', '[id*="Commercial"]'
    ];
    const markers = Array.from(document.querySelectorAll(selectors.join(',')));
    const explicitMarker = markers.some(element => {
      if (!overlapsVideo(element)) return false;
      const text = labelOf(element);
      if (!text || text.length > 160) return false;
      return /広告|(?:^|\s)CM(?:\s|$|[:：\d])|Advertisement|Ad break/i.test(text);
    });
    if (explicitMarker) return true;
    if (!video || !state) return false;

    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    const currentTime = Number.isFinite(video.currentTime) ? video.currentTime : 0;
    const shortAdLength = duration >= 5 && duration <= 65;
    const replacementVideo = state.video && state.video !== video &&
        state.maxTime >= 5 && shortAdLength;
    const sameVideoReset = state.video === video && state.maxTime >= 10 &&
        shortAdLength && currentTime < 5 && video.playbackRate <= 1.05;
    return replacementVideo || sameVideoReset;
  };

)JS";

constexpr wchar_t kNativeMediaTverAdGateSnippet[] = LR"JS(
    const advertisementActive = isTverAdvertisementActive(video, state);
    if (advertisementActive) {
      if (!state.adActive) {
        state.adActive = true;
        state.adVideo = video;
        state.endCandidateAt = 0;
        state.lowQualitySet = false;
        state.restartRequested = false;
        window.__homePanelTverAdActive = true;
        try {
          const exit = document.exitFullscreen || document.webkitExitFullscreen;
          if ((document.fullscreenElement || document.webkitFullscreenElement) &&
              typeof exit === 'function') {
            const result = exit.call(document);
            if (result && typeof result.catch === 'function') result.catch(() => {});
          }
        } catch (_) {
        }
      }
      if (video) {
        try {
          video.defaultPlaybackRate = 1.0;
          if (video.playbackRate !== 1.0) video.playbackRate = 1.0;
        } catch (_) {
        }
      }
      return;
    }
    if (state.adActive) {
      state.adActive = false;
      state.adVideo = null;
      state.video = null;
      state.maxDuration = 0;
      state.maxTime = 0;
      state.endCandidateAt = 0;
      state.lowQualitySet = false;
      state.restartRequested = false;
      window.__homePanelTverAdActive = false;
    }
)JS";

constexpr wchar_t kNativeMediaTverWatchdogAdGate[] =
    L"  if ((state && state.adActive) || window.__homePanelTverAdActive) return null;\n";
constexpr wchar_t kNativeMediaTverFullscreenAdGate[] =
    L"  const state = window.__homePanelSakuraMeetsState;\n"
    L"  if ((state && state.adActive) || window.__homePanelTverAdActive) return;\n";

void InsertNativeMediaSnippetBefore(
    std::wstring* value, std::wstring_view marker,
    std::wstring_view snippet) {
  if (!value) return;
  const size_t position = value->find(marker);
  if (position == std::wstring::npos) return;
  value->insert(position, snippet.data(), snippet.size());
}

void InsertNativeMediaSnippetAfter(
    std::wstring* value, std::wstring_view marker,
    std::wstring_view snippet) {
  if (!value) return;
  const size_t position = value->find(marker);
  if (position == std::wstring::npos) return;
  const size_t insertAt = position + marker.size();
  value->insert(insertAt, snippet.data(), snippet.size());
}

std::wstring RewriteNativeMediaExecuteScriptWithTverAdGuard(
    const wchar_t* script) {
  std::wstring value = RewriteNativeMediaExecuteScript(script);
  if (value.find(L"__homePanelSakuraMeetsLoopTimer") != std::wstring::npos &&
      value.find(L"const playbackRate = 1.75;") != std::wstring::npos &&
      value.find(L"isTverAdvertisementActive") == std::wstring::npos) {
    InsertNativeMediaSnippetBefore(
        &value, L"  const storedSeriesPath = () => {",
        kNativeMediaTverAdDetectorSnippet);
    InsertNativeMediaSnippetBefore(
        &value, L"    if (state.video !== video) {",
        kNativeMediaTverAdGateSnippet);
  }

  if (value.find(L"const state = window.__homePanelSakuraMeetsState;") !=
          std::wstring::npos &&
      value.find(L"if (state && state.restartRequested) return 'restart';") !=
          std::wstring::npos &&
      value.find(L"window.__homePanelTverAdActive") == std::wstring::npos) {
    InsertNativeMediaSnippetAfter(
        &value,
        L"  if (state && state.restartRequested) return 'restart';\n",
        kNativeMediaTverWatchdogAdGate);
  }
  return value;
}

const wchar_t* NativeMediaTverForceFullscreenAdSafeScript() {
  static const std::wstring guarded = [] {
    std::wstring value(kNativeMediaTverForceFullscreenAfterClickScript);
    if (value.find(L"window.__homePanelTverAdActive") == std::wstring::npos) {
      InsertNativeMediaSnippetAfter(
          &value, L"(() => {\n", kNativeMediaTverFullscreenAdGate);
    }
    return value;
  }();
  return guarded.c_str();
}
}  // namespace
