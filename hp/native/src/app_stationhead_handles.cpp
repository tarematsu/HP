#include "app_stationhead_handles.h"

namespace hp {
namespace {

StationheadHandleBase* primaryAudioHandle = nullptr;
StationheadHandleBase* secondaryAudioHandle = nullptr;

constexpr int64_t kStationheadBoundaryRetryDelayMs = 5'000;
constexpr int64_t kStationheadBoundaryRetryWindowMs = 3 * 60'000;

struct TrackBoundaryRetryState {
  bool armed = false;
  // True only after App's 30-second handoff window expired while the target
  // was still stopped. The player's pending bit is deliberately retained and
  // the handle re-opens a fresh App handoff window at retryAt.
  bool detachedFromAppWindow = false;
  int64_t retryAt = 0;
  int64_t deadline = 0;
};

TrackBoundaryRetryState primaryBoundaryRetry;
TrackBoundaryRetryState secondaryBoundaryRetry;

TrackBoundaryRetryState& BoundaryRetryStateFor(
    const StationheadHandleBase* handle) noexcept {
  return handle == secondaryAudioHandle
      ? secondaryBoundaryRetry
      : primaryBoundaryRetry;
}

void ClearBoundaryRetryState(const StationheadHandleBase* handle) noexcept {
  BoundaryRetryStateFor(handle) = {};
}

void ArmBoundaryRetryState(
    const StationheadHandleBase* handle, int64_t nowMs) noexcept {
  TrackBoundaryRetryState& state = BoundaryRetryStateFor(handle);
  if (!state.armed) {
    state.armed = true;
    state.deadline = nowMs + kStationheadBoundaryRetryWindowMs;
  }
  state.detachedFromAppWindow = false;
  state.retryAt = nowMs + kStationheadBoundaryRetryDelayMs;
}

bool RequiresInteractiveStationhead(const StationheadStatus& status) noexcept {
  return status.loginRequired || status.spotifyAuthorization || status.processFailed;
}

StationheadHandleBase* PeerAudioHandle(
    const StationheadHandleBase* handle) noexcept {
  if (handle == primaryAudioHandle) return secondaryAudioHandle;
  if (handle == secondaryAudioHandle) return primaryAudioHandle;
  return nullptr;
}

static_assert(kStationheadBoundaryRetryDelayMs >= 1'000);
static_assert(kStationheadBoundaryRetryWindowMs >
              2 * kStationheadTrackTransitionGraceMs);
}  // namespace

StationheadHandleBase::operator bool() const noexcept {
  return static_cast<bool>(player_);
}

void StationheadHandleBase::Stop() {
  if (!player_ || stopIssued_) return;
  stopIssued_ = true;
  ClearBoundaryRetryState(this);
  if (startIssued_) player_->Stop();
}

void StationheadHandleBase::SetAudioMuted(bool muted) noexcept {
  if (!muted) {
    // Audio-profile changes arrive as two sequential calls. Always mute the
    // outgoing peer before this handle becomes audible so B -> A cannot expose
    // a short interval where both Stationhead streams are heard.
    if (StationheadHandleBase* peer = PeerAudioHandle(this)) {
      peer->SetAudioMuted(true);
    }
  }
  if (audioMuted_ == muted) return;
  audioMuted_ = muted;
  ++contentRevision_;
  if (player_) player_->SetMuted(muted);
}

void StationheadHandleBase::SetBounds(const RECT& bounds) {
  if (!startupPreviewActive_ && EqualRect(&workspaceBounds_, &bounds)) return;
  workspaceBounds_ = bounds;
  ApplyBounds();
}

void StationheadHandleBase::SetStartupPreviewBounds(const RECT& bounds) {
  startupPreviewBounds_ = bounds;
  startupPreviewActive_ = true;
  ApplyBounds();
}

void StationheadHandleBase::ClearStartupPreviewBounds() {
  if (!startupPreviewActive_) return;
  startupPreviewActive_ = false;
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
  int64_t next = player_ ? player_->NextWakeAt() : 0;
  const TrackBoundaryRetryState& retry = BoundaryRetryStateFor(this);
  if (retry.armed && retry.detachedFromAppWindow && retry.retryAt > 0 &&
      (next <= 0 || retry.retryAt < next)) {
    next = retry.retryAt;
  }
  return next;
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
  ClearBoundaryRetryState(this);
  ApplyInteractiveBounds();
  player_->Start();
  ApplyAudioState();
  ApplyBounds();
}

void StationheadHandleBase::Tick(int64_t nowMs) {
  if (!player_ || !startIssued_ || stopIssued_) return;
  player_->RecoverUnavailableAuthorization();
  // Authorization can begin while the steady-state scheduler still carries a
  // much later background deadline. Wake only that interactive state so the
  // auth-controller watchdog is evaluated near its intended 20-second limit
  // without copying the full status strings and history on every App tick.
  if (player_->SpotifyAuthorizationActive()) {
    player_->RequestImmediateTick();
  }
  player_->Tick(nowMs);

  TrackBoundaryRetryState& retry = BoundaryRetryStateFor(this);
  if (!retry.armed) return;
  const StationheadStatus status = player_->Status();
  if (player_->AudioPlaying() || status.navigating ||
      RequiresInteractiveStationhead(status) || nowMs >= retry.deadline) {
    player_->CancelPendingTrackBoundaryRefresh();
    ClearBoundaryRetryState(this);
    return;
  }
  if (!retry.detachedFromAppWindow || nowMs < retry.retryAt) return;

  // App no longer owns a handoff grace window, but the player still owns the
  // same due 52-minute request. Re-open the App window without resetting the
  // player's lastReloadAt_ baseline or waiting for another page message.
  retry.detachedFromAppWindow = false;
  retry.retryAt = nowMs + kStationheadBoundaryRetryDelayMs;
  player_->RetryPendingTrackBoundaryRefresh(nowMs);
  if (player_->Status().navigating) ClearBoundaryRetryState(this);
}

void StationheadHandleBase::Reconnect() {
  if (!player_ || !startIssued_ || stopIssued_) return;
  ClearBoundaryRetryState(this);
  ApplyInteractiveBounds();
  player_->Reconnect();
  ApplyBounds();
}

void StationheadHandleBase::RetryPendingTrackBoundaryRefresh(int64_t nowMs) {
  if (!player_ || !startIssued_ || stopIssued_) return;
  ArmBoundaryRetryState(this, nowMs);
  player_->RetryPendingTrackBoundaryRefresh(nowMs);
  if (player_->Status().navigating) ClearBoundaryRetryState(this);
}

void StationheadHandleBase::CancelPendingTrackBoundaryRefresh() noexcept {
  if (!player_ || !startIssued_ || stopIssued_) return;
  TrackBoundaryRetryState& retry = BoundaryRetryStateFor(this);
  const int64_t nowMs = UnixMillis();
  if (retry.armed && !player_->AudioPlaying() && nowMs < retry.deadline) {
    // Keep the player's pending request alive. Only App's current 30-second
    // handoff window expired; a peer WebView may still be rebuilding its DRM
    // session. Retry with a fresh handoff window instead of losing the 52-minute
    // refresh until a later track-ended message happens to arrive.
    retry.detachedFromAppWindow = true;
    retry.retryAt = nowMs + kStationheadBoundaryRetryDelayMs;
    player_->RequestImmediateTick();
    return;
  }
  player_->CancelPendingTrackBoundaryRefresh();
  ClearBoundaryRetryState(this);
}

void StationheadHandleBase::SetPlaybackFallback(
    bool active, const std::wstring& reason) {
  if (!player_ || !startIssued_ || stopIssued_) return;
  ClearBoundaryRetryState(this);
  player_->SetPlaybackFallback(active, reason);
  ApplyBounds();
}

void StationheadHandleBase::ShowAfterAudioStop() {
  if (!player_ || !startIssued_ || stopIssued_) return;
  ApplyInteractiveBounds();
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
  uint32_t flags = player_->ConsumeChangeFlags();
  if ((flags & StationheadChangeReleaseAuth) != 0) {
    // Complete auth teardown before A/B flags are OR-ed by App. Remove only
    // this player's auth-related ReturnMain request so a simultaneous audio
    // ReturnMain from the other player is not suppressed by ReleaseAuth.
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
  ClearBoundaryRetryState(this);
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
  ClearBoundaryRetryState(this);
  ++contentRevision_;
}

bool StationheadHandleBase::HasAuthTabPlayer() const {
  return player_ && startIssued_ && !stopIssued_ && player_->HasAuthTab();
}

void StationheadHandleBase::SelectPlayerTab(StationheadTabKind tab) {
  if (!player_ || !startIssued_ || stopIssued_) return;
  if (tab == StationheadTabKind::None) {
    RefreshVisibility();
    return;
  }
  ApplyInteractiveBounds();
  player_->SelectTab(tab);
  ApplyBounds();
}

bool StationheadHandleBase::IsInteractive(
    const StationheadStatus& status) const noexcept {
  if (RequiresInteractiveStationhead(status)) return true;
  return !status.audioPlaying &&
          !SuppressTrackTransitionGap(status.audioPlaying, false);
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
  if (!player_ || !startIssued_ || stopIssued_) return;
  const bool preview = startupPreviewActive_;
  if (!preview && !player_->SurfaceVisible()) return;
  HWND host = player_->ActiveHostWindowForAccountSetup();
  if (!host || !IsWindow(host)) return;

  bool interactive = false;
  if (!preview) {
    const StationheadStatus status = RawStatus();
    interactive = IsInteractive(status);
    if (!interactive && !status.visible) return;
  }

  // StationheadPlayer owns host/controller geometry. The handle only raises
  // the already-laid-out active host; moving it here would overwrite resolved
  // single-window/full-client bounds with the caller's stale half bounds.
  SetWindowPos(host, HWND_TOP, 0, 0, 0, 0,
               SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE |
                   SWP_SHOWWINDOW | SWP_NOSENDCHANGING);
  if (!preview && interactive) BringMainWindowToFront(host);
}

void StationheadHandleBase::ApplyInteractiveBounds() {
  if (!player_ || stopIssued_) return;
  // The handle is the sole owner of the startup-preview lifetime. Interactive
  // transitions (login, Spotify auth, reconnect, audio-stop recovery) must not
  // clear the player's preview state and then immediately reapply it, because
  // that exposes a transient workspace-sized or hidden surface between the two
  // calls. Reuse the same atomic placement path as every other bounds update.
  ApplyBounds();
}

void StationheadHandleBase::ApplyBounds() {
  if (!player_ || stopIssued_) return;
  if (startupPreviewActive_) {
    player_->SetStartupPreviewBounds(startupPreviewBounds_);
  } else {
    player_->ClearStartupPreviewBounds();
    player_->SetBounds(workspaceBounds_);
  }
  RaiseActiveHost();
}

AppStationheadHandle::AppStationheadHandle() {
  primaryAudioHandle = this;
  primaryBoundaryRetry = {};
}

AppStationheadHandle::~AppStationheadHandle() {
  ClearBoundaryRetryState(this);
  if (primaryAudioHandle == this) primaryAudioHandle = nullptr;
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

bool AppStationheadHandle::HasAuthTab() const {
  return HasAuthTabPlayer();
}

void AppStationheadHandle::SelectTab(StationheadTabKind tab) {
  SelectPlayerTab(tab);
}

AppSecondaryStationheadHandle::AppSecondaryStationheadHandle() {
  secondaryAudioHandle = this;
  secondaryBoundaryRetry = {};
}

AppSecondaryStationheadHandle::~AppSecondaryStationheadHandle() {
  ClearBoundaryRetryState(this);
  if (secondaryAudioHandle == this) secondaryAudioHandle = nullptr;
}

AppSecondaryStationheadHandle* AppSecondaryStationheadHandle::operator->() noexcept {
  return this;
}

const AppSecondaryStationheadHandle*
AppSecondaryStationheadHandle::operator->() const noexcept {
  return this;
}

AppSecondaryStationheadHandle& AppSecondaryStationheadHandle::operator=(
    std::unique_ptr<StationheadPlayer> player) noexcept {
  AssignPlayer(std::move(player));
  return *this;
}

void AppSecondaryStationheadHandle::reset() noexcept {
  ResetPlayer();
}

}  // namespace hp
