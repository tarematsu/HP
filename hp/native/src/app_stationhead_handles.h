#pragma once
#include "sh.h"

namespace hp {

// Give the refreshed side enough time to rebuild its EME/Widevine playback
// pipeline before the other side is allowed to start its own boundary refresh.
inline constexpr int64_t kStationheadTrackTransitionGraceMs = 30'000;
inline constexpr uint64_t kStationheadSecondaryStartupFallbackMs = 8'000;

inline bool StationheadNeedsForeground(const StationheadStatus& status) noexcept {
  return !status.audioPlaying;
}

inline constexpr bool SecondaryStationheadStartupReady(
    bool primaryCreated,
    uint64_t nowTick,
    uint64_t requestedAtTick) noexcept {
  if (primaryCreated) return true;
  return requestedAtTick > 0 && nowTick >= requestedAtTick &&
      nowTick - requestedAtTick >= kStationheadSecondaryStartupFallbackMs;
}

static_assert(SecondaryStationheadStartupReady(true, 1, 1));
static_assert(!SecondaryStationheadStartupReady(false, 7'999, 1));
static_assert(SecondaryStationheadStartupReady(false, 8'001, 1));

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
  [[nodiscard]] bool AudioPlaying() const noexcept {
    return player_ && player_->AudioPlaying();
  }
  [[nodiscard]] int64_t AudioPlayingSince() const noexcept {
    return player_ ? player_->AudioPlayingSince() : 0;
  }
  void Stop();
  void SetAudioMuted(bool muted) noexcept;
  void SetBounds(const RECT& bounds);
  void SetStartupPreviewBounds(const RECT& bounds);
  void ClearStartupPreviewBounds();
  StationheadStatus RawStatus() const;
  StationheadStatus Status() const;
  int64_t NextWakeAt() const noexcept;
  void RefreshVisibility();
  void Start();
  void Tick(int64_t nowMs);
  void Reconnect();
  void RetryPendingTrackBoundaryRefresh(int64_t nowMs);
  void CancelPendingTrackBoundaryRefresh() noexcept;
  void SetPlaybackFallback(bool active, const std::wstring& reason);
  void ShowAfterAudioStop();
  void ReleaseCompletedAuth();
  uint32_t ConsumeChangeFlags();

 protected:
  StationheadHandleBase() = default;
  ~StationheadHandleBase() = default;

  void AssignPlayer(std::unique_ptr<StationheadPlayer> player) noexcept;
  void ResetPlayer() noexcept;
  bool HasAuthTabPlayer() const;
  void SelectPlayerTab(StationheadTabKind tab);
  [[nodiscard]] bool CanStartPlayer() const noexcept {
    return player_ && !startIssued_ && !stopIssued_;
  }
  [[nodiscard]] bool PlayerStarted() const noexcept {
    return player_ && startIssued_ && !stopIssued_;
  }
  static void SetStartupPrimaryHandle(StationheadHandleBase* handle) noexcept {
    startupPrimaryHandle_ = handle;
  }
  [[nodiscard]] static StationheadHandleBase* StartupPrimaryHandle() noexcept {
    return startupPrimaryHandle_;
  }

 private:
  bool IsInteractive(const StationheadStatus& status) const noexcept;
  bool SuppressTrackTransitionGap(bool playing, bool forceInteractive) const noexcept;
  void ApplyAudioState() const noexcept;
  void BringMainWindowToFront(HWND host) const noexcept;
  void RaiseActiveHost() const;
  void ApplyInteractiveBounds();
  void ApplyBounds();

  std::unique_ptr<StationheadPlayer> player_;
  RECT workspaceBounds_{0, 0, 1, 1};
  RECT startupPreviewBounds_{0, 0, 1, 1};
  bool startupPreviewActive_ = false;
  bool audioMuted_ = false;
  // A handle owns exactly one StationheadPlayer lifecycle. Duplicate Start()
  // calls must not create a second WebView2 controller, and a final Stop() must
  // not restart the same player with stale asynchronous/recreate state.
  bool startIssued_ = false;
  bool stopIssued_ = false;
  mutable bool playbackObserved_ = false;
  mutable int64_t playbackMissingSinceAt_ = 0;
  mutable bool transitionSuppressed_ = false;
  mutable uint64_t contentRevision_ = 1;
  inline static StationheadHandleBase* startupPrimaryHandle_ = nullptr;
};

class AppStationheadHandle final : public StationheadHandleBase {
 public:
  AppStationheadHandle();
  ~AppStationheadHandle();
  AppStationheadHandle(const AppStationheadHandle&) = delete;
  AppStationheadHandle& operator=(const AppStationheadHandle&) = delete;

  AppStationheadHandle* operator->() noexcept;
  const AppStationheadHandle* operator->() const noexcept;
  AppStationheadHandle& operator=(std::unique_ptr<StationheadPlayer> player) noexcept;
  void reset() noexcept;
  void SetStartupPreviewBounds(const RECT& bounds) {
    requestedStartupPreviewBounds_ = bounds;
    startupPreviewRequested_ = true;
    // Register A before App submits B's preview bounds. B can then temporarily
    // expand A over both halves without exposing an empty secondary child host.
    SetStartupPrimaryHandle(this);
    StationheadHandleBase::SetStartupPreviewBounds(bounds);
  }
  void ClearStartupPreviewBounds() {
    startupPreviewRequested_ = false;
    StationheadHandleBase::ClearStartupPreviewBounds();
  }
  void ExpandStartupPreviewForSecondary(const RECT& secondaryBounds) {
    if (!startupPreviewRequested_) return;
    const RECT expanded{
        std::min(requestedStartupPreviewBounds_.left, secondaryBounds.left),
        std::min(requestedStartupPreviewBounds_.top, secondaryBounds.top),
        std::max(requestedStartupPreviewBounds_.right, secondaryBounds.right),
        std::max(requestedStartupPreviewBounds_.bottom, secondaryBounds.bottom)};
    StationheadHandleBase::SetStartupPreviewBounds(expanded);
  }
  void RestoreRequestedStartupPreviewBounds() {
    if (startupPreviewRequested_) {
      StationheadHandleBase::SetStartupPreviewBounds(requestedStartupPreviewBounds_);
    }
  }
  void Start() {
    if (!CanStartPlayer()) return;
    SetStartupPrimaryHandle(this);
    StationheadHandleBase::Start();
  }
  void Stop() {
    StationheadHandleBase::Stop();
    if (StartupPrimaryHandle() == this) SetStartupPrimaryHandle(nullptr);
  }
  bool HasAuthTab() const;
  void SelectTab(StationheadTabKind tab);
  StationheadStatus Status() const {
    StationheadStatus status = StationheadHandleBase::Status();
    if (status.loginRequired || status.spotifyAuthorization || status.processFailed) {
      // Window A can also keep streaming while its interactive account surface
      // needs attention. In a dual-window layout, keep that surface in the left
      // half instead of exposing it as reusable healthy playback.
      status.audioPlaying = false;
      status.playing = false;
    }
    return status;
  }

 private:
  RECT requestedStartupPreviewBounds_{0, 0, 1, 1};
  bool startupPreviewRequested_ = false;
};

class AppSecondaryStationheadHandle final : public StationheadHandleBase {
 public:
  AppSecondaryStationheadHandle();
  ~AppSecondaryStationheadHandle();
  AppSecondaryStationheadHandle(const AppSecondaryStationheadHandle&) = delete;
  AppSecondaryStationheadHandle& operator=(const AppSecondaryStationheadHandle&) = delete;

  AppSecondaryStationheadHandle* operator->() noexcept;
  const AppSecondaryStationheadHandle* operator->() const noexcept;
  AppSecondaryStationheadHandle& operator=(
      std::unique_ptr<StationheadPlayer> player) noexcept;
  void reset() noexcept;
  void SetStartupPreviewBounds(const RECT& bounds) {
    pendingStartupPreviewBounds_ = bounds;
    startupPreviewRequested_ = true;
    startupPreviewApplied_ = false;
    if (AppStationheadHandle* primary = StartupPrimary()) {
      primary->ExpandStartupPreviewForSecondary(bounds);
    }
    ApplyDeferredStartupPreview();
  }
  void ClearStartupPreviewBounds() {
    startupPreviewRequested_ = false;
    startupPreviewApplied_ = false;
    StationheadHandleBase::ClearStartupPreviewBounds();
  }
  void Start() {
    if (!CanStartPlayer()) return;
    if (startupRequestedAtTick_ == 0) {
      const uint64_t nowTick = GetTickCount64();
      startupRequestedAtTick_ = nowTick == 0 ? 1 : nowTick;
    }
    TryStartDeferred();
  }
  void Tick(int64_t nowMs) {
    TryStartDeferred();
    if (PlayerStarted()) {
      StationheadHandleBase::Tick(nowMs);
      ApplyDeferredStartupPreview();
    }
  }
  void Stop() {
    startupRequestedAtTick_ = 0;
    startupPreviewRequested_ = false;
    startupPreviewApplied_ = false;
    StationheadHandleBase::Stop();
  }
  StationheadStatus Status() const {
    StationheadStatus status = StationheadHandleBase::Status();
    if (status.loginRequired || status.spotifyAuthorization || status.processFailed) {
      // Window B can keep streaming after its authenticated API session expires.
      // Treat that state as placement-pending so the App keeps the interactive
      // surface in the right half and does not reuse a healthy-playback snapshot.
      status.audioPlaying = false;
      status.playing = false;
    }
    return status;
  }

 private:
  [[nodiscard]] static AppStationheadHandle* StartupPrimary() noexcept {
    return static_cast<AppStationheadHandle*>(StartupPrimaryHandle());
  }

  void TryStartDeferred() {
    if (!CanStartPlayer() || startupRequestedAtTick_ == 0) return;
    StationheadHandleBase* primary = StartupPrimaryHandle();
    const bool primaryCreated = primary && primary->RawStatus().created;
    if (primary && !SecondaryStationheadStartupReady(
                       primaryCreated, GetTickCount64(), startupRequestedAtTick_)) {
      return;
    }
    StationheadHandleBase::Start();
    if (PlayerStarted()) startupRequestedAtTick_ = 0;
  }

  void ApplyDeferredStartupPreview() {
    if (!startupPreviewRequested_ || startupPreviewApplied_ || !PlayerStarted() ||
        !RawStatus().created) {
      return;
    }
    // The controller is configured before its host is exposed. Prepare B first
    // while A still covers both halves, then restore A to the requested left half.
    StationheadHandleBase::SetStartupPreviewBounds(pendingStartupPreviewBounds_);
    startupPreviewApplied_ = true;
    if (AppStationheadHandle* primary = StartupPrimary()) {
      primary->RestoreRequestedStartupPreviewBounds();
    }
  }

  RECT pendingStartupPreviewBounds_{0, 0, 1, 1};
  uint64_t startupRequestedAtTick_ = 0;
  bool startupPreviewRequested_ = false;
  bool startupPreviewApplied_ = false;
};

}  // namespace hp
