#include "spotify_webviews.h"
#include "shared_webview_environment.h"
#include "media_surface_anchor.h"

namespace hp {
namespace {
constexpr wchar_t kSpotifyHostClass[] = L"HomePanelSpotifyWebView";
constexpr wchar_t kSpotifyLoginUrl[] =
    L"https://accounts.spotify.com/login?continue=https%3A%2F%2Fopen.spotify.com%2Falbum%2F2f2Ik9JeinFVWZuFb3i35b";
// v2 intentionally starts every configured account with a fresh named profile
// once. Keep this namespace stable after the reauthentication rollout so later
// launches reuse the newly authenticated sessions instead of resetting again.
constexpr wchar_t kSpotifyProfilePrefix[] = L"spotify-" L"v2-";

// Four logical Spotify accounts share exactly three runtime lanes. The first
// three accounts start in B/C/D; whichever account completes one full rotation
// leaves its lane, the waiting account takes that lane, and the completed
// account becomes the next waiter.
constexpr size_t kSpotifyRuntimeLaneCount = 3;
std::array<size_t, kSpotifyRuntimeLaneCount> gSpotifyRuntimeLaneAccounts = {
    0, 1, 2};
size_t gSpotifyInactiveAccountIndex = 3;

void ResetSpotifyRuntimeLanes() noexcept {
  gSpotifyRuntimeLaneAccounts = {0, 1, 2};
  gSpotifyInactiveAccountIndex = 3;
}

int SpotifyRuntimeLaneForAccount(size_t accountIndex) noexcept {
  for (size_t lane = 0; lane < gSpotifyRuntimeLaneAccounts.size(); ++lane) {
    if (gSpotifyRuntimeLaneAccounts[lane] == accountIndex) {
      return static_cast<int>(lane);
    }
  }
  return -1;
}

bool SpotifyAccountShouldOwnHost(size_t accountIndex) noexcept {
  return SpotifyRuntimeLaneForAccount(accountIndex) >= 0;
}

SpotifyWebViews* gSpotifyControlInstance = nullptr;
// These are runtime-lane selections (B/C/D => 0/1/2), not logical account ids.
int gSpotifyAudioOutputSlot = -1;
int gSpotifyMonitorForegroundSlot = -1;

void SetSpotifyOutputMuted(const ComPtr<ICoreWebView2>& webview) noexcept {
  if (!webview) return;
  ComPtr<ICoreWebView2_8> audio;
  if (SUCCEEDED(webview.As(&audio)) && audio) {
    const int accountIndex = gSpotifyControlInstance
        ? gSpotifyControlInstance->SlotIndexForWebView(webview.Get())
        : -1;
    const int runtimeLane = accountIndex >= 0
        ? SpotifyRuntimeLaneForAccount(static_cast<size_t>(accountIndex))
        : -1;
    const bool muted =
        runtimeLane < 0 || runtimeLane != gSpotifyAudioOutputSlot;
    audio->put_IsMuted(muted ? TRUE : FALSE);
  }
}

bool StartsWithInsensitive(std::wstring_view value,
                           std::wstring_view prefix) noexcept {
  if (value.size() < prefix.size()) return false;
  for (size_t i = 0; i < prefix.size(); ++i) {
    if (towlower(value[i]) != towlower(prefix[i])) return false;
  }
  return true;
}
}  // namespace

SpotifyWebViews::SpotifyWebViews(HWND parentWindow, fs::path dataDir)
    : parentWindow_(parentWindow),
      // One UDF keeps the browser process family shared. Named profiles below
      // isolate cookies/local storage for every Spotify account.
      userDataFolder_(std::move(dataDir) / L"webview2-youtube-mv") {
  gSpotifyControlInstance = this;
  ResetSpotifyRuntimeLanes();
  monitorForegroundSlot_ = gSpotifyMonitorForegroundSlot;
  for (size_t i = 0; i < slots_.size(); ++i) {
    slots_[i].owner = this;
    slots_[i].index = i;
  }
}

SpotifyWebViews::~SpotifyWebViews() {
  Shutdown();
  if (gSpotifyControlInstance == this) gSpotifyControlInstance = nullptr;
}

int SpotifyWebViews::SlotIndexForWebView(ICoreWebView2* webview) const noexcept {
  if (!webview) return -1;
  for (const Slot& slot : slots_) {
    if (slot.webview.Get() == webview) return static_cast<int>(slot.index);
  }
  return -1;
}

void SpotifyWebViews::SetAudioOutputSlot(int slotIndex) noexcept {
  gSpotifyAudioOutputSlot =
      slotIndex >= 0 && slotIndex < static_cast<int>(kSpotifyRuntimeLaneCount)
          ? slotIndex
          : -1;
  for (Slot& slot : slots_) SetSpotifyOutputMuted(slot.webview);
}

void SetSpotifyAudioOutputSlot(int slotIndex) noexcept {
  if (slotIndex < 0 ||
      slotIndex >= static_cast<int>(kSpotifyRuntimeLaneCount)) {
    slotIndex = -1;
  }
  gSpotifyAudioOutputSlot = slotIndex;
  if (gSpotifyControlInstance) {
    gSpotifyControlInstance->SetAudioOutputSlot(slotIndex);
  }
}

void SetSpotifyMonitorForegroundSlot(int slotIndex) noexcept {
  if (slotIndex < 0 ||
      slotIndex >= static_cast<int>(kSpotifyRuntimeLaneCount)) {
    slotIndex = -1;
  }
  gSpotifyMonitorForegroundSlot = slotIndex;
  if (gSpotifyControlInstance) {
    gSpotifyControlInstance->SetMonitorForegroundSlot(slotIndex);
  }
}

}  // namespace hp
