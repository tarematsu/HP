#pragma once
#include "sh.h"
#include "sh_audio_loss_policy.h"

namespace hp {

inline constexpr int64_t kStationheadTrackTransitionGraceMs =
    kStationheadAudioLossGraceMs;

inline bool StationheadNeedsForeground(const StationheadStatus& status) noexcept {
  return !status.audioPlaying;
}

enum class WorkspaceTab {
  Main = 0,
  Stationhead = 1,
  Auth = 2,
};

class StationheadHandleBase {
 public:
  StationheadHandleBase(const StationheadHandleBase&) = delete;
  StationheadHandleBase& operator=(const StationheadHandleBase&) = delete;

  explicit operator bool() const noexcept;
  void Stop();
  void SetAudioMuted(bool muted) noexcept;
  void SetBounds(const RECT& bounds);
  void SetForegroundAllowed(bool allowed) {
    if (player_) player_->SetForegroundAllowed(allowed);
  }
  StationheadStatus Status() const;
  int64_t NextWakeAt() const noexcept;
  void RefreshVisibility();
  void Start();
  void Tick(int64_t nowMs);
  void ShowAfterAudioStop();
  void ReleaseCompletedAuth();
  uint32_t ConsumeChangeFlags();

 protected:
  StationheadHandleBase() = default;
  ~StationheadHandleBase() = default;
  void AssignPlayer(std::unique_ptr<StationheadPlayer> player) noexcept;
  void ResetPlayer() noexcept;

 private:
  StationheadStatus RawStatus() const;
  bool IsInteractive(const StationheadStatus& status) const noexcept;
  bool SuppressTrackTransitionGap(bool playing, bool forceInteractive) const noexcept;
  void ApplyAudioState() const noexcept;
  void BringMainWindowToFront(HWND host) const noexcept;
  void RaiseActiveHost() const;
  void ApplyBounds();

  std::unique_ptr<StationheadPlayer> player_;
  RECT workspaceBounds_{0, 0, 1, 1};
  bool audioMuted_ = false;
  bool startIssued_ = false;
  bool stopIssued_ = false;
  mutable bool playbackObserved_ = false;
  mutable MonotonicElapsedTimestamp playbackMissingSinceAt_;
  mutable bool transitionSuppressed_ = false;
  mutable uint64_t contentRevision_ = 1;
};

class AppStationheadHandle final : public StationheadHandleBase {
 public:
  AppStationheadHandle() = default;
  ~AppStationheadHandle() = default;
  AppStationheadHandle(const AppStationheadHandle&) = delete;
  AppStationheadHandle& operator=(const AppStationheadHandle&) = delete;

  AppStationheadHandle* operator->() noexcept;
  const AppStationheadHandle* operator->() const noexcept;
  AppStationheadHandle& operator=(std::unique_ptr<StationheadPlayer> player) noexcept;
  void reset() noexcept;
  StationheadStatus Status() const {
    StationheadStatus status = StationheadHandleBase::Status();
    if (status.loginRequired || status.spotifyAuthorization || status.processFailed) {
      status.audioPlaying = false;
      status.playing = false;
    }
    return status;
  }
};

}  // namespace hp