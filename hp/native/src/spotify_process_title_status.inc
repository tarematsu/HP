namespace hp {
namespace {

constexpr ULONGLONG kSpotifyProcessTitlePollMs = 60ULL * 1000ULL;

constexpr wchar_t kSpotifyPlaybackMetadataScript[] = LR"JS(
(() => {
  const media = navigator.mediaSession && navigator.mediaSession.metadata;
  return {
    mediaTitle: media && typeof media.title === 'string' ? media.title : '',
    documentTitle: typeof document.title === 'string' ? document.title : ''
  };
})()
)JS";

std::wstring_view TrimSpotifyProcessTitle(std::wstring_view value) noexcept {
  while (!value.empty() && iswspace(value.front())) value.remove_prefix(1);
  while (!value.empty() && iswspace(value.back())) value.remove_suffix(1);
  return value;
}

bool EqualsSpotifyProcessTitleInsensitive(
    std::wstring_view left, std::wstring_view right) noexcept {
  if (left.size() != right.size()) return false;
  for (size_t i = 0; i < left.size(); ++i) {
    if (towlower(left[i]) != towlower(right[i])) return false;
  }
  return true;
}

bool StartsWithSpotifyOpenSource(std::wstring_view value) noexcept {
  constexpr std::wstring_view prefix = L"https://open.spotify.com/";
  if (value.size() < prefix.size()) return false;
  for (size_t i = 0; i < prefix.size(); ++i) {
    if (towlower(value[i]) != towlower(prefix[i])) return false;
  }
  return true;
}

bool EqualsSpotifySourceInsensitive(
    std::wstring_view left, std::wstring_view right) noexcept {
  while (!left.empty() && left.back() == L'/') left.remove_suffix(1);
  while (!right.empty() && right.back() == L'/') right.remove_suffix(1);
  return EqualsSpotifyProcessTitleInsensitive(left, right);
}

std::wstring SpotifyProcessTrackDisplay(std::wstring_view processTitle) {
  processTitle = TrimSpotifyProcessTitle(processTitle);
  constexpr std::array<std::wstring_view, 3> suffixes = {
      L" | Spotify", L" - Spotify", L" – Spotify"};
  for (const std::wstring_view suffix : suffixes) {
    if (processTitle.size() < suffix.size()) continue;
    const std::wstring_view tail = processTitle.substr(processTitle.size() - suffix.size());
    if (EqualsSpotifyProcessTitleInsensitive(tail, suffix)) {
      processTitle = TrimSpotifyProcessTitle(
          processTitle.substr(0, processTitle.size() - suffix.size()));
      break;
    }
  }

  if (processTitle.empty() ||
      EqualsSpotifyProcessTitleInsensitive(processTitle, L"Spotify") ||
      EqualsSpotifyProcessTitleInsensitive(processTitle, L"Spotify Web Player") ||
      EqualsSpotifyProcessTitleInsensitive(
          processTitle, L"Spotify – Web Player: Music for everyone")) {
    return {};
  }

  constexpr std::array<std::wstring_view, 4> separators = {
      L" - ", L"•", L"・", L"·"};
  size_t separator = std::wstring_view::npos;
  size_t separatorLength = 0;
  for (const std::wstring_view candidate : separators) {
    const size_t found = processTitle.find(candidate);
    if (found == std::wstring_view::npos ||
        (separator != std::wstring_view::npos && found >= separator)) {
      continue;
    }
    separator = found;
    separatorLength = candidate.size();
  }
  if (separator == std::wstring_view::npos) return {};

  const std::wstring_view track = TrimSpotifyProcessTitle(processTitle.substr(0, separator));
  const std::wstring_view artist = TrimSpotifyProcessTitle(
      processTitle.substr(separator + separatorLength));
  if (track.empty() || artist.empty()) return {};
  return std::wstring(track);
}

std::wstring SpotifyTrackFromMetadataJson(LPCWSTR json) {
  if (!json || !*json) return {};
  try {
    const auto root = winrt::Windows::Data::Json::JsonObject::Parse(json);
    std::wstring mediaTitle(
        root.GetNamedString(L"mediaTitle", L"").c_str());
    const std::wstring_view trimmedMediaTitle =
        TrimSpotifyProcessTitle(mediaTitle);
    if (!trimmedMediaTitle.empty()) return std::wstring(trimmedMediaTitle);

    std::wstring documentTitle(
        root.GetNamedString(L"documentTitle", L"").c_str());
    return SpotifyProcessTrackDisplay(documentTitle);
  } catch (...) {
    return {};
  }
}

std::wstring ReadNativeWindowTitle(HWND hwnd) {
  if (!hwnd || !IsWindow(hwnd)) return {};
  const int length = GetWindowTextLengthW(hwnd);
  if (length <= 0) return {};
  std::wstring text(static_cast<size_t>(length) + 1, L'\0');
  const int copied = GetWindowTextW(hwnd, text.data(), length + 1);
  if (copied <= 0) return {};
  text.resize(static_cast<size_t>(copied));
  return text;
}

struct SpotifyWindowTitleProbe {
  DWORD processId = 0;
  std::wstring track;
};

BOOL CALLBACK CaptureSpotifyChildWindowTitle(HWND hwnd, LPARAM parameter) {
  auto* probe = reinterpret_cast<SpotifyWindowTitleProbe*>(parameter);
  if (!probe || !probe->track.empty()) return FALSE;
  try {
    probe->track = SpotifyProcessTrackDisplay(ReadNativeWindowTitle(hwnd));
  } catch (...) {
    probe->track.clear();
  }
  return probe->track.empty() ? TRUE : FALSE;
}

BOOL CALLBACK CaptureSpotifyProcessWindowTitle(HWND hwnd, LPARAM parameter) {
  auto* probe = reinterpret_cast<SpotifyWindowTitleProbe*>(parameter);
  if (!probe || !probe->processId || !probe->track.empty()) return FALSE;
  DWORD processId = 0;
  GetWindowThreadProcessId(hwnd, &processId);
  if (processId != probe->processId) return TRUE;
  try {
    probe->track = SpotifyProcessTrackDisplay(ReadNativeWindowTitle(hwnd));
  } catch (...) {
    probe->track.clear();
  }
  return probe->track.empty() ? TRUE : FALSE;
}

std::wstring ProbeSpotifyChildWindowTrack(HWND hostWindow) {
  SpotifyWindowTitleProbe probe;
  if (hostWindow && IsWindow(hostWindow)) {
    EnumChildWindows(hostWindow, CaptureSpotifyChildWindowTitle,
                     reinterpret_cast<LPARAM>(&probe));
  }
  return probe.track;
}

bool SpotifyFrameCollectionContainsSource(
    ICoreWebView2FrameInfoCollection* frames,
    std::wstring_view expectedSource) noexcept {
  if (!frames || expectedSource.empty()) return false;
  ComPtr<ICoreWebView2FrameInfoCollectionIterator> iterator;
  if (FAILED(frames->GetIterator(&iterator)) || !iterator) return false;
  BOOL hasCurrent = FALSE;
  while (SUCCEEDED(iterator->get_HasCurrent(&hasCurrent)) && hasCurrent) {
    ComPtr<ICoreWebView2FrameInfo> frame;
    if (SUCCEEDED(iterator->GetCurrent(&frame)) && frame) {
      LPWSTR rawSource = nullptr;
      if (SUCCEEDED(frame->get_Source(&rawSource)) && rawSource) {
        const bool matches = EqualsSpotifySourceInsensitive(rawSource, expectedSource);
        CoTaskMemFree(rawSource);
        if (matches) return true;
      }
    }
    BOOL hasNext = FALSE;
    if (FAILED(iterator->MoveNext(&hasNext)) || !hasNext) break;
  }
  return false;
}

std::wstring ProbeSpotifyRendererWindowTrack(
    ICoreWebView2ProcessExtendedInfoCollection* processCollection,
    std::wstring_view expectedSource) {
  if (!processCollection || expectedSource.empty()) return {};
  UINT32 count = 0;
  if (FAILED(processCollection->get_Count(&count))) return {};
  for (UINT32 i = 0; i < count; ++i) {
    ComPtr<ICoreWebView2ProcessExtendedInfo> extendedInfo;
    if (FAILED(processCollection->GetValueAtIndex(i, &extendedInfo)) ||
        !extendedInfo) {
      continue;
    }
    ComPtr<ICoreWebView2ProcessInfo> processInfo;
    if (FAILED(extendedInfo->get_ProcessInfo(&processInfo)) || !processInfo) {
      continue;
    }
    COREWEBVIEW2_PROCESS_KIND kind{};
    if (FAILED(processInfo->get_Kind(&kind)) ||
        kind != COREWEBVIEW2_PROCESS_KIND_RENDERER) {
      continue;
    }
    ComPtr<ICoreWebView2FrameInfoCollection> frames;
    if (FAILED(extendedInfo->get_AssociatedFrameInfos(&frames)) ||
        !SpotifyFrameCollectionContainsSource(frames.Get(), expectedSource)) {
      continue;
    }
    INT32 processId = 0;
    if (FAILED(processInfo->get_ProcessId(&processId)) || processId <= 0) {
      continue;
    }
    SpotifyWindowTitleProbe probe{static_cast<DWORD>(processId), {}};
    EnumWindows(CaptureSpotifyProcessWindowTitle,
                reinterpret_cast<LPARAM>(&probe));
    if (!probe.track.empty()) return probe.track;
  }
  return {};
}

}  // namespace

void SpotifyWebViews::RefreshProcessTitleStatus(
    Slot& slot, ICoreWebView2* webview) noexcept {
  if (!webview || slot.webview.Get() != webview) return;

  // Read the now-playing value from the WebView itself first. Unlike the native
  // HWND/renderer title, Media Session metadata and document.title remain
  // queryable while the Spotify surface is clipped to 1x1 in the background.
  Slot* const metadataTarget = &slot;
  const auto metadataAlive = alive_;
  ComPtr<ICoreWebView2> metadataWebview = slot.webview;
  const HRESULT metadataStarted = metadataWebview->ExecuteScript(
      kSpotifyPlaybackMetadataScript,
      Callback<ICoreWebView2ExecuteScriptCompletedHandler>(
          [metadataAlive, metadataTarget, metadataWebview](
              HRESULT result, LPCWSTR json) -> HRESULT {
            if (!metadataAlive->load(std::memory_order_acquire) ||
                metadataTarget->webview.Get() != metadataWebview.Get() ||
                FAILED(result)) {
              return S_OK;
            }
            std::wstring display;
            try {
              display = SpotifyTrackFromMetadataJson(json);
            } catch (...) {
              return S_OK;
            }
            if (display.empty() ||
                (metadataTarget->processTitleObserved &&
                 metadataTarget->processTrackDisplay == display)) {
              return S_OK;
            }
            metadataTarget->processTrackDisplay = std::move(display);
            metadataTarget->processTitleObserved = true;
            GetLocalTime(&metadataTarget->processTitleObservedAt);
            InvalidateSpotifyStatusForHost(metadataTarget->hostWindow);
            return S_OK;
          }).Get());
  if (SUCCEEDED(metadataStarted)) return;

  // Fallback only when script dispatch itself is unavailable. This path keeps
  // compatibility with older WebView2 failure modes but is no longer the normal
  // status source because native window titles can stop changing while clipped.
  std::wstring display;
  try {
    display = ProbeSpotifyChildWindowTrack(slot.hostWindow);
  } catch (...) {
    return;
  }
  if (!display.empty()) {
    if (slot.processTitleObserved && slot.processTrackDisplay == display) return;
    slot.processTrackDisplay = std::move(display);
    slot.processTitleObserved = true;
    GetLocalTime(&slot.processTitleObservedAt);
    InvalidateSpotifyStatusForHost(slot.hostWindow);
    return;
  }

  LPWSTR rawSource = nullptr;
  if (FAILED(webview->get_Source(&rawSource)) || !rawSource) return;
  std::wstring expectedSource;
  try {
    if (StartsWithSpotifyOpenSource(rawSource)) expectedSource.assign(rawSource);
  } catch (...) {
    CoTaskMemFree(rawSource);
    return;
  }
  CoTaskMemFree(rawSource);
  if (expectedSource.empty()) return;

  // The task-manager-visible title can belong to the renderer rather than a
  // descendant HWND of our host. Resolve the renderer by this WebView's current
  // top-level Spotify URL so two Spotify profiles, YouTube and TVer cannot be
  // mistaken for each other in the shared WebView2 environment.
  ComPtr<ICoreWebView2Environment13> environment13;
  if (!slot.environment || FAILED(slot.environment.As(&environment13)) ||
      !environment13) {
    return;
  }
  const auto alive = alive_;
  Slot* const target = &slot;
  ComPtr<ICoreWebView2> expectedWebview = slot.webview;
  const HRESULT queryResult = environment13->GetProcessExtendedInfos(
      Callback<ICoreWebView2GetProcessExtendedInfosCompletedHandler>(
          [this, alive, target, expectedWebview, expectedSource](
              HRESULT result,
              ICoreWebView2ProcessExtendedInfoCollection* processCollection)
              -> HRESULT {
            if (!alive->load(std::memory_order_acquire) || FAILED(result) ||
                !processCollection || target->webview.Get() != expectedWebview.Get()) {
              return S_OK;
            }
            std::wstring rendererDisplay;
            try {
              rendererDisplay = ProbeSpotifyRendererWindowTrack(
                  processCollection, expectedSource);
            } catch (...) {
              return S_OK;
            }
            if (rendererDisplay.empty() ||
                (target->processTitleObserved &&
                 target->processTrackDisplay == rendererDisplay)) {
              return S_OK;
            }
            target->processTrackDisplay = std::move(rendererDisplay);
            target->processTitleObserved = true;
            GetLocalTime(&target->processTitleObservedAt);
            InvalidateSpotifyStatusForHost(target->hostWindow);
            return S_OK;
          }).Get());
  (void)queryResult;
}

void SpotifyWebViews::PollProcessTitleStatus(ULONGLONG now) noexcept {
  for (Slot& slot : slots_) {
    if (!slot.webview) continue;
    if (slot.nextProcessTitlePollTick != 0 && now < slot.nextProcessTitlePollTick) {
      continue;
    }
    RefreshProcessTitleStatus(slot, slot.webview.Get());
    slot.nextProcessTitlePollTick = now + kSpotifyProcessTitlePollMs;
  }
}

}  // namespace hp
