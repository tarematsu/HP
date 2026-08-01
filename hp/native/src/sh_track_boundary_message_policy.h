#pragma once
#include "common.h"

namespace hp {

inline constexpr int64_t kStationheadAlternationIntervalMs = 2 * 60'000;
inline constexpr UINT kStationheadAudioActionMessage = WM_APP + 22;
inline constexpr WPARAM kStationheadAudioToggleAction = 3;
inline constexpr WPARAM kStationheadAudioMuteAction = 4;

struct StationheadAlternationAction {
  bool switchAudio = false;
  bool preserveMute = false;
};

namespace stationhead_alternation_policy {
inline SRWLOCK lock = SRWLOCK_INIT;
inline bool primaryPlaying = false;
inline bool secondaryPlaying = false;
inline bool primaryMuted = false;
inline bool secondaryMuted = true;
inline ULONGLONG nextSwitchAt = 0;
}  // namespace stationhead_alternation_policy

inline StationheadAlternationAction ObserveStationheadAlternation(
    bool secondary, bool playing, bool muted) noexcept {
  StationheadAlternationAction action;
  const ULONGLONG now = GetTickCount64();
  AcquireSRWLockExclusive(&stationhead_alternation_policy::lock);
  if (secondary) {
    stationhead_alternation_policy::secondaryPlaying = playing;
    stationhead_alternation_policy::secondaryMuted = muted;
  } else {
    stationhead_alternation_policy::primaryPlaying = playing;
    stationhead_alternation_policy::primaryMuted = muted;
  }

  const bool bothPlaying =
      stationhead_alternation_policy::primaryPlaying &&
      stationhead_alternation_policy::secondaryPlaying;
  if (!bothPlaying) {
    stationhead_alternation_policy::nextSwitchAt = 0;
  } else if (stationhead_alternation_policy::nextSwitchAt == 0) {
    stationhead_alternation_policy::nextSwitchAt =
        now + static_cast<ULONGLONG>(kStationheadAlternationIntervalMs);
  } else if (!secondary &&
             now >= stationhead_alternation_policy::nextSwitchAt) {
    stationhead_alternation_policy::nextSwitchAt =
        now + static_cast<ULONGLONG>(kStationheadAlternationIntervalMs);
    action.switchAudio = true;
    action.preserveMute =
        stationhead_alternation_policy::primaryMuted &&
        stationhead_alternation_policy::secondaryMuted;
  }
  ReleaseSRWLockExclusive(&stationhead_alternation_policy::lock);
  return action;
}

inline int64_t StationheadAlternationNextWakeAt(bool secondary) noexcept {
  if (secondary) return 0;
  ULONGLONG due = 0;
  AcquireSRWLockShared(&stationhead_alternation_policy::lock);
  due = stationhead_alternation_policy::nextSwitchAt;
  ReleaseSRWLockShared(&stationhead_alternation_policy::lock);
  if (due == 0) return 0;
  const ULONGLONG now = GetTickCount64();
  const ULONGLONG remaining = due > now ? due - now : 0;
  const int64_t wallNow = UnixMillis();
  if (remaining > static_cast<ULONGLONG>(INT64_MAX - wallNow)) {
    return INT64_MAX;
  }
  return wallNow + static_cast<int64_t>(remaining);
}

static_assert(kStationheadAlternationIntervalMs == 120'000);
static_assert(kStationheadAudioToggleAction == 3);
static_assert(kStationheadAudioMuteAction == 4);

}  // namespace hp

// Extend StationheadPlayer while sh.h is parsed. A/B remain on their dedicated
// station pages; only the native mute profile changes every two minutes after
// both WebViews report real audio. No periodic navigation or reload is used.
#define NextWakeAt()                                                          \
  NextWakeAt() const noexcept {                                               \
    int64_t next = NextWakeAtBase();                                          \
    const int64_t alternation =                                               \
        ::hp::StationheadAlternationNextWakeAt(IsSecondary());                \
    if (alternation > 0 && (next <= 0 || alternation < next)) {               \
      next = alternation;                                                     \
    }                                                                         \
    return next;                                                              \
  }                                                                           \
  [[nodiscard]] int64_t NextWakeAtBase()

#define RecoverUnavailableAuthorization()                                    \
  RecoverUnavailableAuthorization() {                                        \
    RecoverUnavailableAuthorizationBase();                                   \
    RefreshAlternatingStationheadAudio();                                     \
  }                                                                           \
  void RecoverUnavailableAuthorizationBase()

// Disable every legacy page/track-boundary refresh path. The two dedicated
// Stationhead pages are long-lived and alternation is audio routing only.
#define RetryPendingTrackBoundaryRefresh(parameters)                         \
  RetryPendingTrackBoundaryRefresh(parameters) {                             \
    (void)nowMs;                                                              \
    trackBoundaryRefreshPending_ = false;                                     \
    return false;                                                             \
  }                                                                           \
  bool RetryPendingTrackBoundaryRefreshDisabled(parameters)

#define nextAutoClickAt_                                                      \
  nextAutoClickAt_ = 0;                                                       \
  void RefreshAlternatingStationheadAudio() {                                 \
    const ::hp::StationheadAlternationAction action =                         \
        ::hp::ObserveStationheadAlternation(                                  \
            IsSecondary(), AudioPlaying(), Muted());                          \
    if (!action.switchAudio || !window_ || !IsWindow(window_)) return;        \
    log_.Info(L"Stationhead two-minute A/B audio alternation requested");    \
    PostMessageW(window_, ::hp::kStationheadAudioActionMessage,               \
                 ::hp::kStationheadAudioToggleAction, 0);                     \
    if (action.preserveMute) {                                                \
      PostMessageW(window_, ::hp::kStationheadAudioActionMessage,             \
                   ::hp::kStationheadAudioMuteAction, 0);                     \
    }                                                                         \
  }                                                                           \
  int64_t stationheadAlternationPolicyAnchor_

#include "sh.h"

#undef nextAutoClickAt_
#undef RetryPendingTrackBoundaryRefresh
#undef RecoverUnavailableAuthorization
#undef NextWakeAt

namespace hp {

inline constexpr int64_t StationheadBoundaryElapsedMs(
    ULONGLONG startedAt, ULONGLONG now) noexcept {
  if (startedAt == 0 || now < startedAt) return 0;
  constexpr ULONGLONG kMaxSignedMilliseconds =
      9'223'372'036'854'775'807ULL;
  const ULONGLONG elapsed = now - startedAt;
  return elapsed > kMaxSignedMilliseconds
      ? static_cast<int64_t>(kMaxSignedMilliseconds)
      : static_cast<int64_t>(elapsed);
}

inline constexpr int64_t StationheadOperationalDeadlineValue(
    bool active, bool reached, int64_t projectedWallDeadline) noexcept {
  if (!active) return 0;
  return reached ? 1 : projectedWallDeadline;
}

inline int64_t StationheadProjectedDeadlineValue(
    const MonotonicProjectedDeadline& deadline) noexcept {
  return StationheadOperationalDeadlineValue(
      deadline.Active(), deadline.Reached(), static_cast<int64_t>(deadline));
}

inline bool operator>=(
    int64_t, const MonotonicProjectedDeadline& deadline) noexcept {
  return deadline.Reached();
}

inline bool operator<(
    int64_t, const MonotonicProjectedDeadline& deadline) noexcept {
  return deadline.Active() && !deadline.Reached();
}

inline int64_t StationheadPolicyWallMillis() noexcept {
  FILETIME fileTime{};
  GetSystemTimeAsFileTime(&fileTime);
  ULARGE_INTEGER ticks{};
  ticks.LowPart = fileTime.dwLowDateTime;
  ticks.HighPart = fileTime.dwHighDateTime;
  constexpr ULONGLONG kUnixEpochFileTimeTicks = 116'444'736'000'000'000ULL;
  if (ticks.QuadPart <= kUnixEpochFileTimeTicks) return 0;
  const ULONGLONG milliseconds =
      (ticks.QuadPart - kUnixEpochFileTimeTicks) / 10'000ULL;
  return milliseconds > static_cast<ULONGLONG>(INT64_MAX)
      ? INT64_MAX
      : static_cast<int64_t>(milliseconds);
}

inline bool StationheadStartupAwareWakePending(
    const StartupAwareWakeDeadline& deadline) noexcept {
  const int64_t projected = static_cast<int64_t>(deadline);
  return projected > 0 && projected > StationheadPolicyWallMillis();
}

inline bool operator<(
    int64_t, const StartupAwareWakeDeadline& deadline) noexcept {
  return StationheadStartupAwareWakePending(deadline);
}

inline bool operator>(
    const MonotonicProjectedDeadline& deadline, int candidate) noexcept {
  if (candidate == 0) return deadline.Active();
  return StationheadProjectedDeadlineValue(deadline) > candidate;
}

inline bool operator<=(
    const MonotonicProjectedDeadline& deadline, int candidate) noexcept {
  if (candidate == 0) return !deadline.Active();
  return StationheadProjectedDeadlineValue(deadline) <= candidate;
}

inline bool operator<(
    const MonotonicProjectedDeadline& deadline, int64_t candidate) noexcept {
  if (!deadline.Active()) return false;
  if (deadline.Reached()) return candidate > 1;
  return static_cast<int64_t>(deadline) < candidate;
}

static_assert(StationheadBoundaryElapsedMs(1'000, 4'120) == 3'120);
static_assert(StationheadBoundaryElapsedMs(4'120, 1'000) == 0);
static_assert(StationheadOperationalDeadlineValue(false, false, 42) == 0);
static_assert(StationheadOperationalDeadlineValue(true, true, 42) == 1);
static_assert(StationheadOperationalDeadlineValue(true, false, 42) == 42);

namespace stationhead_boundary_message_policy {
inline SRWLOCK reloadClockLock = SRWLOCK_INIT;
inline ULONGLONG primaryReloadMonotonicAt = 0;
inline ULONGLONG secondaryReloadMonotonicAt = 0;
inline MonotonicProjectedDeadline primaryAutoClickDeadline;
inline MonotonicProjectedDeadline secondaryAutoClickDeadline;
inline int64_t primaryAutoClickExposed = 0;
inline int64_t secondaryAutoClickExposed = 0;
}  // namespace stationhead_boundary_message_policy

inline int64_t& StationheadAutoClickDeadlineStorage(
    int64_t& storage, bool secondary) noexcept {
  MonotonicProjectedDeadline& deadline = secondary
      ? stationhead_boundary_message_policy::secondaryAutoClickDeadline
      : stationhead_boundary_message_policy::primaryAutoClickDeadline;
  int64_t& exposed = secondary
      ? stationhead_boundary_message_policy::secondaryAutoClickExposed
      : stationhead_boundary_message_policy::primaryAutoClickExposed;
  if (storage != exposed) deadline = storage;
  storage = StationheadProjectedDeadlineValue(deadline);
  exposed = storage;
  return storage;
}

class StationheadBoundaryReloadClockProxy {
 public:
  StationheadBoundaryReloadClockProxy(
      int64_t& storage, bool secondary, bool configured) noexcept
      : storage_(storage), secondary_(secondary), configured_(configured) {}

  operator int64_t() const noexcept { return storage_; }

  int64_t operator=(int64_t candidate) noexcept {
    AcquireSRWLockExclusive(
        &stationhead_boundary_message_policy::reloadClockLock);
    const bool accept = configured_ && storage_ <= 0;
    if (accept) {
      storage_ = candidate;
      ULONGLONG& monotonicAt = secondary_
          ? stationhead_boundary_message_policy::secondaryReloadMonotonicAt
          : stationhead_boundary_message_policy::primaryReloadMonotonicAt;
      monotonicAt = GetTickCount64();
    }
    ReleaseSRWLockExclusive(
        &stationhead_boundary_message_policy::reloadClockLock);
    return candidate;
  }

  friend int64_t operator-(
      int64_t wallClockNow,
      const StationheadBoundaryReloadClockProxy& clock) noexcept {
    ULONGLONG monotonicAt = 0;
    AcquireSRWLockShared(
        &stationhead_boundary_message_policy::reloadClockLock);
    monotonicAt = clock.secondary_
        ? stationhead_boundary_message_policy::secondaryReloadMonotonicAt
        : stationhead_boundary_message_policy::primaryReloadMonotonicAt;
    ReleaseSRWLockShared(
        &stationhead_boundary_message_policy::reloadClockLock);
    if (monotonicAt == 0) return wallClockNow - clock.storage_;
    return StationheadBoundaryElapsedMs(monotonicAt, GetTickCount64());
  }

 private:
  int64_t& storage_;
  bool secondary_;
  bool configured_;
};

inline StationheadBoundaryReloadClockProxy StationheadBoundaryReloadClock(
    int64_t& storage, bool secondary, bool configured) noexcept {
  return StationheadBoundaryReloadClockProxy(storage, secondary, configured);
}

inline constexpr bool StationheadFocusSurfaceIsInteractive(
    LONG width, LONG height) noexcept {
  return width > 1 && height > 1;
}

static_assert(!StationheadFocusSurfaceIsInteractive(1, 1));
static_assert(!StationheadFocusSurfaceIsInteractive(1, 720));
static_assert(!StationheadFocusSurfaceIsInteractive(1280, 1));
static_assert(StationheadFocusSurfaceIsInteractive(2, 2));

inline bool StationheadFocusRemainsInteractive(
    HWND target, HWND focused) noexcept {
  if (!target || !focused || focused == target ||
      !IsWindow(target) || !IsWindow(focused)) {
    return false;
  }

  HWND surface = focused;
  HWND parent = GetParent(surface);
  while (parent && parent != target) {
    surface = parent;
    parent = GetParent(surface);
  }
  if (parent != target || !IsWindowVisible(surface)) return false;

  RECT client{};
  if (!GetClientRect(surface, &client)) return false;
  return StationheadFocusSurfaceIsInteractive(
      client.right - client.left, client.bottom - client.top);
}

inline HWND SetFocusAfterStationheadHide(HWND target) noexcept {
  const HWND focused = GetFocus();
  if (StationheadFocusRemainsInteractive(target, focused)) return focused;
  return ::SetFocus(target);
}

}  // namespace hp

#define lastReloadAt_                                                        \
  (::hp::StationheadBoundaryReloadClock(                                    \
      (lastReloadAtStorage_), IsSecondary(), webViewConfigured_))
#define nextAutoClickAt_                                                     \
  (::hp::StationheadAutoClickDeadlineStorage(                               \
      (nextAutoClickAt_), IsSecondary()))
#define SetFocus(target) (::hp::SetFocusAfterStationheadHide((target)))

#include "sh_shared.h"

namespace hp {
inline constexpr int64_t kStationheadMeasuredPostPlaybackStopClickDelayMs =
    3'500;
static_assert(kStationheadMeasuredPostPlaybackStopClickDelayMs < 12'000);
}  // namespace hp

#define kStationheadPostPlaybackStopClickDelayMs                             \
  (::hp::kStationheadMeasuredPostPlaybackStopClickDelayMs)
