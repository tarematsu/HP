#include "app_stationhead_handles.h"
#include "stationhead_monitor_probe.h"

namespace hp {
#include "stationhead_status_strip_bridge.h"
namespace {

constexpr int64_t kStationheadBoundaryRetryWindowMs = 3 * 60'000;

struct TrackBoundaryRetryState {
  bool armed = false;
  MonotonicProjectedDeadline deadline;
};

TrackBoundaryRetryState boundaryRetry;

void ClearBoundaryRetryState() noexcept {
  boundaryRetry = {};
}

void ArmBoundaryRetryState(int64_t nowMs) noexcept {
  if (boundaryRetry.armed) return;
  boundaryRetry.armed = true;
  boundaryRetry.deadline = nowMs + kStationheadBoundaryRetryWindowMs;
}

bool RequiresInteractiveStationhead(const StationheadStatus& status) noexcept {
  return status.loginRequired || status.spotifyAuthorization || status.processFailed;
}

void SyncStationheadBackgroundPreview(
    StationheadPlayer& player, const RECT& workspaceBounds) {
  const StationheadStatus status = player.Status();
  const bool settledPlayback =
      player.AudioPlaying() && !status.navigating &&
      !status.loginRequired && !status.spotifyAuthorization;
  if (settledPlayback && SetStationheadBackgroundPreview(false)) {
    player.SetBounds(workspaceBounds);
  }
}

static_assert(kStationheadBoundaryRetryWindowMs >
              2 * kStationheadTrackTransitionGraceMs);
}  // namespace

StationheadHandleBase::operator bool() const noexcept {
  return static_cast<bool>(player_);
}

void StationheadHandleBase::Stop() {
  if (!player_ || stopIssued_) return;
  stopIssued_ = true;
  ClearBoundaryRetryState();
  if (startIssued_) player_->Stop();
}

void StationheadHandleBase::SetAudioMuted(bool muted) noexcept {
  if (audioMuted_ == muted) return;
  audioMuted_ = muted;
  ++contentRevision_;
  if (player_) player_->SetMuted(muted);
}

void StationheadHandleBase::SetBounds(const RECT& bounds) {
  if (!EqualRect(&workspaceBounds_, &bounds)) workspaceBounds_ = bounds;
  ApplyBounds();
}

StationheadStatus StationheadHandleBase::RawStatus() const {
  StationheadStatus status = player_ ? player_->Status() : StationheadStatus{};
  const bool audioPlaying = player_ && player_->AudioPlaying();
  status.audioPlaying = audioPlaying;
  status.playing = audioPlaying;
  status.contentRevision = contentRevision_;
  status.audioMuted = audioMuted_;
  return status;
}

StationheadStatus StationheadHandleBase::Status() const {
  StationheadStatus status = RawStatus();
  const bool transitionSuppressed = player_ && SuppressTrackTransitionGap(
      status.audioPlaying, RequiresInteractiveStationhead(status));
  if (transitionSuppressed) {
    if (status.visible) player_->KeepPlaybackBehindDashboard();
    status.audioPlaying = true;
    status.playing = true;
    status.visible = false;
    status.detail = L"track transition; waiting for next audio";
  }
  if (transitionSuppressed_ != transitionSuppressed) {
    transitionSuppressed_ = transitionSuppressed;
    ++contentRevision_;
  }
  status.contentRevision = contentRevision_;
  return status;
}

int64_t StationheadHandleBase::NextWakeAt() const noexcept {
  return player_ ? player_->NextWakeAt() : 0;
}

void StationheadHandleBase::RefreshVisibility() {
  if (!player_) return;
  const StationheadStatus status = RawStatus();
  if (SuppressTrackTransitionGap(
          status.audioPlaying, RequiresInteractiveStationhead(status))) {
    if (status.visible) player_->KeepPlaybackBehindDashboard();
    return;
  }
  player_->SelectTab(StationheadTabKind::None);
  ApplyBounds();
}

void StationheadHandleBase::Start() {
  if (!player_ || startIssued_ || stopIssued_) return;
  startIssued_ = true;
  ClearBoundaryRetryState();
  SetStationheadBackgroundPreview(true);
  ApplyBounds();
  player_->Start();
  ApplyAudioState();
  ApplyBounds();
}

void StationheadHandleBase::Tick(int64_t nowMs) {
  if (!player_ || !startIssued_ || stopIssued_) return;
  player_->RecoverUnavailableAuthorization();
  SyncStationheadBackgroundPreview(*player_, workspaceBounds_);
  if (player_->SpotifyAuthorizationActive()) player_->RequestImmediateTick();
  player_->Tick(nowMs);
  player_->EvaluateAudioLossRecovery(nowMs);
  SyncStationheadBackgroundPreview(*player_, workspaceBounds_);
  RaiseActiveHost();

  if (!boundaryRetry.armed && !player_->AudioPlaying()) {
    const bool active = player_->RetryPendingTrackBoundaryRefresh(nowMs);
    if (active) {
      ArmBoundaryRetryState(nowMs);
      if (player_->Status().navigating) ClearBoundaryRetryState();
    }
  }
  if (!boundaryRetry.armed) return;

  const StationheadStatus status = player_->Status();
  if (player_->AudioPlaying() || status.navigating ||
      RequiresInteractiveStationhead(status) || nowMs >= boundaryRetry.deadline) {
    player_->CancelPendingTrackBoundaryRefresh();
    ClearBoundaryRetryState();
  }
}

void StationheadHandleBase::ShowAfterAudioStop() {
  if (!player_ || !startIssued_ || stopIssued_) return;
  player_->ShowAfterAudioStop();
  ApplyBounds();
}

void StationheadHandleBase::ReleaseCompletedAuth() {
  if (!player_ || !startIssued_ || stopIssued_) return;
  player_->FinalizeCompletedAuth();
  ApplyBounds();
}

uint32_t StationheadHandleBase::ConsumeChangeFlags() {
  if (!player_ || !startIssued_ || stopIssued_) return StationheadChangeNone;
  SyncStationheadBackgroundPreview(*player_, workspaceBounds_);
  uint32_t flags = player_->ConsumeChangeFlags();
  if ((flags & StationheadChangeReleaseAuth) != 0) {
    player_->FinalizeCompletedAuth();
    ApplyBounds();
    flags &= ~(StationheadChangeReleaseAuth | StationheadChangeReturnMain);
  }
  ++contentRevision_;
  return flags;
}

void StationheadHandleBase::AssignPlayer(
    std::unique_ptr<StationheadPlayer> player) noexcept {
  player_ = std::move(player);
  startIssued_ = false;
  stopIssued_ = false;
  playbackObserved_ = false;
  playbackMissingSinceAt_ = 0;
  transitionSuppressed_ = false;
  ClearBoundaryRetryState();
  ++contentRevision_;
  ApplyAudioState();
  ApplyBounds();
}

void StationheadHandleBase::ResetPlayer() noexcept {
  player_.reset();
  startIssued_ = false;
  stopIssued_ = false;
  playbackObserved_ = false;
  playbackMissingSinceAt_ = 0;
  transitionSuppressed_ = false;
  ClearBoundaryRetryState();
  ++contentRevision_;
}

bool StationheadHandleBase::IsInteractive(
    const StationheadStatus& status) const noexcept {
  return status.loginRequired || status.spotifyAuthorization;
}

bool StationheadHandleBase::SuppressTrackTransitionGap(
    bool playing, bool forceInteractive) const noexcept {
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
  return now - playbackMissingSinceAt_ < kStationheadTrackTransitionGraceMs;
}

void StationheadHandleBase::ApplyAudioState() const noexcept {
  if (player_ && !stopIssued_) player_->SetMuted(audioMuted_);
}

void StationheadHandleBase::BringMainWindowToFront(HWND host) const noexcept {
  if (!host || !IsWindow(host)) return;
  HWND root = GetAncestor(host, GA_ROOT);
  if (!root || !IsWindow(root) || GetForegroundWindow() == root) return;
  SetWindowPos(root, HWND_TOP, 0, 0, 0, 0,
               SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW | SWP_NOSENDCHANGING);
  UpdateWindow(root);
}

void StationheadHandleBase::RaiseActiveHost() const {
  if (!player_ || !startIssued_ || stopIssued_ || !player_->SurfaceVisible()) return;
  HWND host = player_->ActiveHostWindowForAccountSetup();
  if (!host || !IsWindow(host)) return;

  const StationheadStatus status = RawStatus();
  const bool interactive = IsInteractive(status);
  if (!interactive && !status.visible) return;

  SetWindowPos(host, HWND_TOP, 0, 0, 0, 0,
               SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE |
                   SWP_SHOWWINDOW | SWP_NOSENDCHANGING);
  if (interactive) BringMainWindowToFront(host);
}

void StationheadHandleBase::ApplyBounds() {
  if (!player_ || stopIssued_) return;
  player_->SetBounds(workspaceBounds_);
  RaiseActiveHost();
}

AppStationheadHandle* AppStationheadHandle::operator->() noexcept {
  return this;
}

const AppStationheadHandle* AppStationheadHandle::operator->() const noexcept {
  return this;
}

AppStationheadHandle& AppStationheadHandle::operator=(
    std::unique_ptr<StationheadPlayer> player) noexcept {
  AssignPlayer(std::move(player));
  return *this;
}

void AppStationheadHandle::reset() noexcept {
  ResetPlayer();
}

}  // namespace hp
