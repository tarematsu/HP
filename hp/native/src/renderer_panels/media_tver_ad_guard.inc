// TVer ad-boundary and state-driven playback handling. The established TVer
// scripts live in renderer_panels.cpp; patch them at runtime so the very large
// raw strings do not grow and hit MSVC's string-literal limit.
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
      const adVideoChanged = state.adVideo !== video;
      if (!state.adActive || adVideoChanged) {
        state.adActive = true;
        state.adVideo = video || null;
        state.endCandidateAt = 0;
        state.lowQualitySet = false;
        state.playbackSettingsApplied = false;
        state.restartRequested = false;
        window.__homePanelTverAdActive = true;
        if (video) {
          try {
            // Restore native ad speed once at the ad boundary. Do not keep
            // writing playback/quality/fullscreen state while the ad runs.
            video.defaultPlaybackRate = 1.0;
            if (video.playbackRate !== 1.0) video.playbackRate = 1.0;
          } catch (_) {
          }
        }
      }
      window.__homePanelTverAdActive = true;
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
      state.playbackSettingsApplied = false;
      state.fullscreenDirty = true;
      state.restartRequested = false;
    }
    window.__homePanelTverAdActive = false;
)JS";

constexpr wchar_t kNativeMediaTverStateDrivenPlaybackSnippet[] = LR"JS(
    if (typeof state.playbackSettingsApplied !== 'boolean') {
      state.playbackSettingsApplied = false;
    }
    if (typeof state.fullscreenDirty !== 'boolean') {
      state.fullscreenDirty = true;
    }
    if (!window.__homePanelTverFullscreenTrackerBound) {
      const markFullscreenState = () => {
        const activeState = window.__homePanelSakuraMeetsState;
        if (!activeState) return;
        const fullscreen = document.fullscreenElement ||
            document.webkitFullscreenElement || document.msFullscreenElement;
        activeState.fullscreenDirty = !fullscreen;
      };
      document.addEventListener('fullscreenchange', markFullscreenState);
      document.addEventListener('webkitfullscreenchange', markFullscreenState);
      window.__homePanelTverFullscreenTrackerBound = true;
    }
    if (state.video !== video) {
      state.video = video;
      state.lowQualitySet = false;
      state.playbackSettingsApplied = false;
      state.fullscreenDirty = true;
    }
    if (video && video.__homePanelTverRateGuardState !== state) {
      video.__homePanelTverRateGuardState = state;
      video.addEventListener('ratechange', () => {
        const activeState = window.__homePanelSakuraMeetsState;
        if (activeState !== state || activeState.adActive ||
            window.__homePanelTverAdActive) return;
        if (video.playbackRate !== playbackRate) {
          try {
            video.defaultPlaybackRate = playbackRate;
            video.playbackRate = playbackRate;
          } catch (_) {
          }
        }
      });
    }
    if (video) {
      if (!state.playbackSettingsApplied) {
        try {
          video.defaultPlaybackRate = playbackRate;
          if (video.playbackRate !== playbackRate) video.playbackRate = playbackRate;
          video.muted = false;
          if (video.volume === 0) video.volume = 1;
        } catch (_) {
        }
        state.playbackSettingsApplied = true;
      }
)JS";

constexpr wchar_t kNativeMediaTverOriginalPlaybackStart[] = LR"JS(
    if (state.video !== video) {
      state.video = video;
      state.lowQualitySet = false;
    }
    if (video) {
      video.defaultPlaybackRate = playbackRate;
      if (video.playbackRate !== playbackRate) video.playbackRate = playbackRate;
)JS";

constexpr wchar_t kNativeMediaTverRepeatedVolumeSnippet[] = LR"JS(
      video.muted = false;
      if (video.volume === 0) video.volume = 1;
)JS";

constexpr wchar_t kNativeMediaTverWatchdogAdGate[] =
    L"  if ((state && state.adActive) || window.__homePanelTverAdActive) return null;\n";
constexpr wchar_t kNativeMediaTverWatchdogStableFullscreenGate[] =
    L"  if (state && state.fullscreenDirty === false) return null;\n";
constexpr wchar_t kNativeMediaTverWatchdogFullscreenConfirmed[] =
    L"  if (fullscreen) {\n"
    L"    if (state) state.fullscreenDirty = false;\n"
    L"    return null;\n"
    L"  }\n";
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

void ReplaceNativeMediaSnippet(
    std::wstring* value, std::wstring_view marker,
    std::wstring_view replacement) {
  if (!value) return;
  const size_t position = value->find(marker);
  if (position == std::wstring::npos) return;
  value->replace(position, marker.size(), replacement.data(), replacement.size());
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
    ReplaceNativeMediaSnippet(
        &value, kNativeMediaTverOriginalPlaybackStart,
        kNativeMediaTverStateDrivenPlaybackSnippet);
    ReplaceNativeMediaSnippet(
        &value, kNativeMediaTverRepeatedVolumeSnippet, L"");
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
    InsertNativeMediaSnippetBefore(
        &value,
        L"  const video = Array.from(document.querySelectorAll('video')).find(visible) || null;",
        kNativeMediaTverWatchdogStableFullscreenGate);
    ReplaceNativeMediaSnippet(
        &value, L"  if (fullscreen) return null;\n",
        kNativeMediaTverWatchdogFullscreenConfirmed);
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
