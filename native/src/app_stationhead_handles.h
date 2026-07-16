#pragma once
#include "sh.h"

namespace hp {

inline bool StationheadNeedsForeground(const StationheadStatus& status) noexcept {
  return !status.audioPlaying;
}

enum class WorkspaceTab {
  Main = 0,
  Stationhead = 1,
  Auth = 2,
};

template <typename Derived, typename PlayerT>
class StationheadHandleBase {
 public:
  explicit operator bool() const noexcept { return static_cast<bool>(player_); }
  Derived* operator->() noexcept { return static_cast<Derived*>(this); }
  const Derived* operator->() const { return static_cast<const Derived*>(this); }

  void Stop() {
    if (player_) player_->Stop();
  }

  void SetAudioMuted(bool muted) noexcept {
    if (audioMuted_ == muted) return;
    audioMuted_ = muted;
    if (player_) player_->SetMuted(muted);
  }

  void SetBounds(const RECT& bounds) {
    if (!startupPreviewActive_ && EqualRect(&workspaceBounds_, &bounds)) return;
    workspaceBounds_ = bounds;
    ApplyBounds();
  }

  void SetStartupPreviewBounds(const RECT& bounds) {
    startupPreviewBounds_ = bounds;
    startupPreviewActive_ = true;
    ApplyBounds();
  }

  void ClearStartupPreviewBounds() {
    if (!startupPreviewActive_) return;
    startupPreviewActive_ = false;
    ApplyBounds();
  }

  StationheadStatus RawStatus() const {
    StationheadStatus status = player_ ? player_->Status() : StationheadStatus{};
    status.audioMuted = audioMuted_;
    return status;
  }

  StationheadStatus Status() const {
    StationheadStatus status = RawStatus();
    const bool forceInteractive = status.loginRequired || status.spotifyAuthorization ||
                                  status.processFailed;
    if (player_ && SuppressTrackTransitionGap(status.audioPlaying, forceInteractive)) {
      if (status.visible) player_->KeepPlaybackBehindDashboard();
      status.audioPlaying = true;
      status.playing = true;
      status.visible = false;
      status.detail = L"track transition; waiting for next audio";
    }
    return status;
  }

  int64_t NextWakeAt() const noexcept {
    return player_ ? player_->NextWakeAt() : 0;
  }

  bool IsInteractive(const StationheadStatus& status) const noexcept {
    const bool forceInteractive = status.loginRequired || status.spotifyAuthorization ||
                                  status.processFailed;
    if (forceInteractive) return true;
    return !status.audioPlaying &&
           !SuppressTrackTransitionGap(status.audioPlaying, false);
  }

  void RefreshVisibility() {
    if (!player_) return;
    const StationheadStatus status = player_->Status();
    const bool forceInteractive = status.loginRequired || status.spotifyAuthorization ||
                                  status.processFailed;
    if (SuppressTrackTransitionGap(status.audioPlaying, forceInteractive)) {
      if (status.visible) player_->KeepPlaybackBehindDashboard();
      return;
    }
    player_->SelectTab(StationheadTabKind::None);
    ApplyBounds();
  }

 protected:
  static constexpr int64_t kTrackTransitionGraceMs = 12'000;

  bool SuppressTrackTransitionGap(bool playing, bool forceInteractive) const noexcept {
    if (playing) {
      playbackObserved_ = true;
      playbackMissingSinceAt_ = 0;
      return false;
    }
    if (forceInteractive || !playbackObserved_) {
      playbackMissingSinceAt_ = 0;
      return false;
    }
    const int64_t now = UnixMillis();
    if (playbackMissingSinceAt_ == 0) playbackMissingSinceAt_ = now;
    return now - playbackMissingSinceAt_ < kTrackTransitionGraceMs;
  }

  void ResetTrackTransitionGrace() noexcept {
    playbackObserved_ = false;
    playbackMissingSinceAt_ = 0;
  }

  void ApplyAudioState() const noexcept {
    if (player_) player_->SetMuted(audioMuted_);
  }

  void BringMainWindowToFront(HWND host) const noexcept {
    if (!host || !IsWindow(host)) return;
    HWND root = GetAncestor(host, GA_ROOT);
    if (!root || !IsWindow(root) || GetForegroundWindow() == root) return;
    SetWindowPos(root, HWND_TOP, 0, 0, 0, 0,
                 SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW | SWP_NOSENDCHANGING);
    UpdateWindow(root);
  }

  void RaiseActiveHost() const {
    if (!player_) return;
    const bool preview = startupPreviewActive_;
    if (!preview && !player_->SurfaceVisible()) return;
    HWND host = player_->ActiveHostWindowForAccountSetup();
    if (!host || !IsWindow(host)) return;
    bool interactive = false;
    if (!preview) {
      const auto status = player_->Status();
      interactive = IsInteractive(status);
      if (!interactive && !status.visible) return;
    }
    const RECT activeBounds = preview ? startupPreviewBounds_ : workspaceBounds_;
    const int width = std::max(1L, activeBounds.right - activeBounds.left);
    const int height = std::max(1L, activeBounds.bottom - activeBounds.top);
    SetWindowPos(host, HWND_TOP, activeBounds.left, activeBounds.top, width, height,
                 SWP_NOACTIVATE | SWP_SHOWWINDOW | SWP_NOSENDCHANGING);
    if (!preview && interactive) BringMainWindowToFront(host);
  }

  void ApplyInteractiveBounds() {
    if (!player_) return;
    player_->ClearStartupPreviewBounds();
    player_->SetBounds(workspaceBounds_);
  }

  void ApplyBounds() {
    if (!player_) return;
    if (startupPreviewActive_) {
      player_->SetStartupPreviewBounds(startupPreviewBounds_);
    } else {
      player_->ClearStartupPreviewBounds();
      player_->SetBounds(workspaceBounds_);
    }
    RaiseActiveHost();
  }

  std::unique_ptr<PlayerT> player_;
  RECT workspaceBounds_{0, 0, 1, 1};
  RECT startupPreviewBounds_{0, 0, 1, 1};
  bool startupPreviewActive_ = false;
  bool audioMuted_ = false;
  mutable bool playbackObserved_ = false;
  mutable int64_t playbackMissingSinceAt_ = 0;
};

class AppStationheadHandle
    : public StationheadHandleBase<AppStationheadHandle, StationheadPlayer> {
 public:
  AppStationheadHandle() = default;
  AppStationheadHandle(const AppStationheadHandle&) = delete;
  AppStationheadHandle& operator=(const AppStationheadHandle&) = delete;

  AppStationheadHandle& operator=(std::unique_ptr<StationheadPlayer> player) noexcept {
    player_ = std::move(player);
    ApplyAudioState();
    ApplyBounds();
    return *this;
  }

  void reset() noexcept {
    player_.reset();
    selectedTab_ = StationheadTabKind::None;
    ResetTrackTransitionGrace();
  }

  void Start() {
    if (!player_) return;
    ApplyInteractiveBounds();
    player_->Start();
    ApplyAudioState();
    ApplyBounds();
  }

  void Tick(int64_t nowMs) {
    if (player_) player_->Tick(nowMs);
  }

  void Reconnect() {
    if (!player_) return;
    ApplyInteractiveBounds();
    player_->Reconnect();
    ApplyBounds();
  }

  void SetPlaybackFallback(bool active, const std::wstring& reason) {
    if (!player_) return;
    player_->SetPlaybackFallback(active, reason);
    ApplyBounds();
  }

  void ShowAfterAudioStop() {
    if (!player_) return;
    ApplyInteractiveBounds();
    player_->ShowAfterAudioStop();
    ApplyBounds();
  }

  void ReleaseCompletedAuth() {
    if (!player_) return;
    player_->ReleaseCompletedAuth();
    ApplyBounds();
  }

  uint32_t ConsumeChangeFlags() {
    return player_ ? player_->ConsumeChangeFlags() : StationheadChangeNone;
  }

  bool HasAuthTab() const { return player_ && player_->HasAuthTab(); }

  void SelectTab(StationheadTabKind tab) {
    selectedTab_ = tab;
    if (!player_) return;
    if (tab == StationheadTabKind::None) {
      RefreshVisibility();
      return;
    }
    ApplyInteractiveBounds();
    player_->SelectTab(tab);
    ApplyBounds();
  }

 private:
  StationheadTabKind selectedTab_ = StationheadTabKind::None;
};

class AppSecondaryStationheadHandle
    : public StationheadHandleBase<AppSecondaryStationheadHandle, StationheadPlayer> {
 public:
  AppSecondaryStationheadHandle() = default;
  AppSecondaryStationheadHandle(const AppSecondaryStationheadHandle&) = delete;
  AppSecondaryStationheadHandle& operator=(const AppSecondaryStationheadHandle&) = delete;

  AppSecondaryStationheadHandle& operator=(
      std::unique_ptr<StationheadPlayer> player) noexcept {
    player_ = std::move(player);
    ApplyAudioState();
    ApplyBounds();
    return *this;
  }

  void reset() noexcept {
    player_.reset();
    ResetTrackTransitionGrace();
  }

  void Start() {
    if (!player_) return;
    ApplyInteractiveBounds();
    player_->Start();
    ApplyAudioState();
    ApplyBounds();
  }

  void Tick(int64_t nowMs) {
    if (player_) player_->Tick(nowMs);
  }

  void Reconnect() {
    if (!player_) return;
    ApplyInteractiveBounds();
    player_->Reconnect();
    ApplyBounds();
  }

  void SetPlaybackFallback(bool active, const std::wstring& reason) {
    if (!player_) return;
    player_->SetPlaybackFallback(active, reason);
    ApplyBounds();
  }

  void ShowAfterAudioStop() {
    if (!player_) return;
    ApplyInteractiveBounds();
    player_->ShowAfterAudioStop();
    ApplyBounds();
  }

  void ReleaseCompletedAuth() {
    if (!player_) return;
    player_->ReleaseCompletedAuth();
    ApplyBounds();
  }

  uint32_t ConsumeChangeFlags() {
    return player_ ? player_->ConsumeChangeFlags() : StationheadChangeNone;
  }
};

}  // namespace hp
