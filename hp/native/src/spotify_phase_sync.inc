namespace hp {
namespace {

constexpr UINT_PTR kSpotifyRobustReconcileTimer = 0x53505243;
constexpr UINT kSpotifyRobustReconcileTickMs = 2U * 1000U;
constexpr ULONGLONG kSpotifyRobustNavigateRetryMs = 20ULL * 1000ULL;
constexpr ULONGLONG kSpotifyRobustControllerRetryMs = 20ULL * 1000ULL;
constexpr int kSpotifyRobustReloadThreshold = 30;

bool SpotifyUrlStartsWith(std::wstring_view value,
                          std::wstring_view prefix) noexcept {
  if (value.size() < prefix.size()) return false;
  for (size_t i = 0; i < prefix.size(); ++i) {
    if (towlower(value[i]) != towlower(prefix[i])) return false;
  }
  return true;
}

bool IsSpotifyLoginSource(std::wstring_view source) noexcept {
  return SpotifyUrlStartsWith(source, L"https://accounts.spotify.com/") ||
         SpotifyUrlStartsWith(source, L"https://open.spotify.com/login");
}

bool IsSpotifyOpenSource(std::wstring_view source) noexcept {
  return SpotifyUrlStartsWith(source, L"https://open.spotify.com/");
}

}  // namespace

void SpotifyWebViews::ArmRobustScheduler() noexcept {
  if (slots_.empty()) return;
  HWND host = slots_[0].hostWindow;
  if (!host || !IsWindow(host)) return;
  KillTimer(host, kSpotifyRobustReconcileTimer);
  ::SetTimer(host, kSpotifyRobustReconcileTimer,
             kSpotifyRobustReconcileTickMs,
             &SpotifyWebViews::StaggeredReconcileTimerProc);
}

bool SpotifyWebViews::SlotIsLoginPage(const Slot& slot) const noexcept {
  if (!slot.webview) return false;
  LPWSTR rawSource = nullptr;
  if (FAILED(slot.webview->get_Source(&rawSource)) || !rawSource) return false;
  const std::wstring source(rawSource);
  CoTaskMemFree(rawSource);
  return IsSpotifyLoginSource(source);
}

void SpotifyWebViews::BeginControllerCreate(Slot& slot) noexcept {
  if (!slot.hostWindow || !IsWindow(slot.hostWindow) ||
      slot.controller || slot.webview) {
    slot.controllerCreating = false;
    slot.controllerCreateTick = 0;
    return;
  }

  const ULONGLONG now = GetTickCount64();
  if (slot.controllerCreating && slot.controllerCreateTick != 0 &&
      now - slot.controllerCreateTick < kSpotifyRobustControllerRetryMs) {
    return;
  }

  slot.controllerCreating = true;
  slot.controllerCreateTick = now;
  CreateController(slot);
}

bool SpotifyWebViews::ParseNormalizedPoint(
    LPCWSTR json, int* x, int* y) noexcept {
  if (!json || !x || !y) return false;
  try {
    const std::wstring value(json);
    if (value.size() < 5 || value.front() != L'[') return false;
    const size_t comma = value.find(L',');
    const size_t close = value.find(
        L']', comma == std::wstring::npos ? 0 : comma + 1);
    if (comma == std::wstring::npos || close == std::wstring::npos) return false;
    const int parsedX = std::stoi(value.substr(1, comma - 1));
    const int parsedY = std::stoi(value.substr(comma + 1, close - comma - 1));
    if (parsedX < 0 || parsedX > 10000 || parsedY < 0 || parsedY > 10000) {
      return false;
    }
    *x = parsedX;
    *y = parsedY;
    return true;
  } catch (...) {
    return false;
  }
}

void SpotifyWebViews::ClickSlotNormalizedPoint(
    Slot& slot, int xTenThousandths, int yTenThousandths) noexcept {
  if (!slot.webview || !slot.hostWindow || !IsWindow(slot.hostWindow)) return;
  slot.playing = false;
  RefreshSpotifyHostLayout();
  DispatchSpotifyDevToolsClick(slot, xTenThousandths, yTenThousandths);
}

}  // namespace hp
