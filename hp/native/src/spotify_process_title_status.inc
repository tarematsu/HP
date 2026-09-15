namespace hp {
namespace {

constexpr ULONGLONG kSpotifyProcessTitlePollMs = 60ULL * 1000ULL;

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

  size_t separator = processTitle.find(L'•');
  if (separator == std::wstring_view::npos) separator = processTitle.find(L'・');
  if (separator == std::wstring_view::npos) return {};

  const std::wstring_view track = TrimSpotifyProcessTitle(processTitle.substr(0, separator));
  const std::wstring_view artist = TrimSpotifyProcessTitle(processTitle.substr(separator + 1));
  if (track.empty() || artist.empty()) return {};

  std::wstring display(track);
  display.push_back(L'・');
  display.append(artist);
  return display;
}

}  // namespace

void SpotifyWebViews::RefreshProcessTitleStatus(
    Slot& slot, ICoreWebView2* webview) noexcept {
  if (!webview || slot.webview.Get() != webview) return;
  LPWSTR rawTitle = nullptr;
  if (FAILED(webview->get_DocumentTitle(&rawTitle)) || !rawTitle) return;
  std::wstring display;
  try {
    display = SpotifyProcessTrackDisplay(rawTitle);
  } catch (...) {
    CoTaskMemFree(rawTitle);
    return;
  }
  CoTaskMemFree(rawTitle);

  // Spotify can briefly expose a generic document title while the WebView is
  // navigating, backgrounded, or re-rendering. Do not erase the last known
  // track on that transient state; the periodic watchdog below will refresh it
  // as soon as a valid track title is observable again.
  if (display.empty()) return;

  slot.processTrackDisplay = std::move(display);
  slot.processTitleObserved = true;
  GetLocalTime(&slot.processTitleObservedAt);
  InvalidateSpotifyStatusForHost(slot.hostWindow);
}

void SpotifyWebViews::PollProcessTitleStatusFallback(ULONGLONG now) noexcept {
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
