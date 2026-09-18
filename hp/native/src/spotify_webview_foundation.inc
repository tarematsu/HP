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

SpotifyWebViews* gSpotifyControlInstance = nullptr;
// Control buttons are pinned to logical Spotify account ids (S1-S5 => 0-4).
// Runtime lanes are now permanently one-to-one with those account ids.
int gSpotifyAudioOutputAccountIndex = -1;
int gSpotifyAudioOutputSlot = -1;
int gSpotifyMonitorForegroundAccountIndex = -1;
int gSpotifyMonitorForegroundSlot = -1;
bool gSpotifyMonitorGridVisible = false;

int SpotifyRuntimeLaneForControlAccount(int accountIndex) noexcept {
  if (accountIndex < 0 ||
      accountIndex >= static_cast<int>(kSpotifyActiveAccountCount)) {
    return -1;
  }
  return SpotifyRuntimeLaneForAccount(static_cast<size_t>(accountIndex));
}

void SetSpotifyOutputMuted(const ComPtr<ICoreWebView2>& webview) noexcept {
  if (!webview) return;
  if (gSpotifyControlInstance) {
    gSpotifyControlInstance->EnsureProcessFailureMonitoring(webview.Get());
  }
  ComPtr<ICoreWebView2_8> audio;
  if (SUCCEEDED(webview.As(&audio)) && audio) {
    const int accountIndex = gSpotifyControlInstance
        ? gSpotifyControlInstance->SlotIndexForWebView(webview.Get())
        : -1;
    const int runtimeLane = accountIndex >= 0
        ? SpotifyRuntimeLaneForAccount(static_cast<size_t>(accountIndex))
        : -1;
    gSpotifyAudioOutputSlot =
        SpotifyRuntimeLaneForControlAccount(gSpotifyAudioOutputAccountIndex);
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
  gSpotifyMonitorForegroundSlot = SpotifyRuntimeLaneForControlAccount(
      gSpotifyMonitorForegroundAccountIndex);
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
  gSpotifyAudioOutputAccountIndex =
      slotIndex >= 0 && slotIndex < static_cast<int>(kSpotifyActiveAccountCount)
          ? slotIndex
          : -1;
  gSpotifyAudioOutputSlot =
      SpotifyRuntimeLaneForControlAccount(gSpotifyAudioOutputAccountIndex);
  for (Slot& slot : slots_) SetSpotifyOutputMuted(slot.webview);
}

void SetSpotifyAudioOutputSlot(int slotIndex) noexcept {
  if (slotIndex < 0 ||
      slotIndex >= static_cast<int>(kSpotifyActiveAccountCount)) {
    slotIndex = -1;
  }
  gSpotifyAudioOutputAccountIndex = slotIndex;
  gSpotifyAudioOutputSlot = SpotifyRuntimeLaneForControlAccount(slotIndex);
  if (gSpotifyControlInstance) {
    gSpotifyControlInstance->SetAudioOutputSlot(slotIndex);
  }
}

void SetSpotifyMonitorForegroundSlot(int slotIndex) noexcept {
  if (slotIndex < 0 ||
      slotIndex >= static_cast<int>(kSpotifyActiveAccountCount)) {
    slotIndex = -1;
  }
  gSpotifyMonitorForegroundAccountIndex = slotIndex;
  gSpotifyMonitorForegroundSlot = SpotifyRuntimeLaneForControlAccount(slotIndex);
  if (gSpotifyControlInstance) {
    gSpotifyControlInstance->SetMonitorForegroundSlot(slotIndex);
  }
}

void SetSpotifyMonitorGridVisible(bool visible) noexcept {
  if (gSpotifyMonitorGridVisible == visible) return;
  gSpotifyMonitorGridVisible = visible;
  if (gSpotifyControlInstance) gSpotifyControlInstance->Resize();
}

}  // namespace hp