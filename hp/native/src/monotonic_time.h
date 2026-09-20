#pragma once

#include "common.h"

namespace hp {

// Keep elapsed-time decisions independent of system-clock changes while still
// retaining the assigned UTC value for logging and persisted timestamps.
class MonotonicElapsedTimestamp {
 public:
  MonotonicElapsedTimestamp() noexcept = default;

  MonotonicElapsedTimestamp& operator=(int64_t wallTime) noexcept {
    wallTime_ = wallTime;
    if (wallTime <= 0) {
      startedTick_ = 0;
      initialElapsedMs_ = 0;
      return *this;
    }
    const int64_t wallNow = UnixMillis();
    initialElapsedMs_ = wallTime < wallNow
        ? static_cast<uint64_t>(wallNow - wallTime)
        : 0;
    const uint64_t nowTick = GetTickCount64();
    startedTick_ = nowTick == 0 ? 1 : nowTick;
    return *this;
  }

  [[nodiscard]] bool Active() const noexcept { return startedTick_ != 0; }
  [[nodiscard]] int64_t WallTime() const noexcept { return wallTime_; }
  [[nodiscard]] int64_t ElapsedMilliseconds() const noexcept {
    if (!Active()) return 0;
    const uint64_t nowTick = GetTickCount64();
    const uint64_t elapsedSinceAssignment =
        nowTick >= startedTick_ ? nowTick - startedTick_ : 0;
    const uint64_t elapsed = elapsedSinceAssignment > UINT64_MAX - initialElapsedMs_
        ? UINT64_MAX
        : initialElapsedMs_ + elapsedSinceAssignment;
    return elapsed > static_cast<uint64_t>(INT64_MAX)
        ? INT64_MAX
        : static_cast<int64_t>(elapsed);
  }

  operator int64_t() const noexcept { return wallTime_; }

  friend int64_t operator-(
      int64_t, const MonotonicElapsedTimestamp& timestamp) noexcept {
    return timestamp.ElapsedMilliseconds();
  }

  // Polling code expresses its next run as `lastRun + interval`. Re-project
  // that deadline from monotonic elapsed time so a civil-clock correction
  // between runs cannot turn a short remaining interval into an hour-long wait.
  friend int64_t operator+(
      const MonotonicElapsedTimestamp& timestamp, int64_t intervalMs) noexcept {
    if (!timestamp.Active()) return 0;
    const int64_t elapsed = timestamp.ElapsedMilliseconds();
    const int64_t remaining = intervalMs > elapsed ? intervalMs - elapsed : 0;
    const int64_t wallNow = UnixMillis();
    return remaining > INT64_MAX - wallNow ? INT64_MAX : wallNow + remaining;
  }

 private:
  int64_t wallTime_ = 0;
  uint64_t startedTick_ = 0;
  uint64_t initialElapsedMs_ = 0;
};

inline int64_t operator+(
    const MonotonicElapsedTimestamp& timestamp, int intervalMs) noexcept {
  return timestamp + static_cast<int64_t>(intervalMs);
}

// Audio callbacks and App handoff checks share this timestamp. Preserve the
// existing atomic load/store interface, but project the returned start time from
// uptime so a system-clock correction cannot invalidate continuous-audio age.
class AtomicMonotonicElapsedTimestamp {
 public:
  AtomicMonotonicElapsedTimestamp() noexcept = default;
  AtomicMonotonicElapsedTimestamp(const AtomicMonotonicElapsedTimestamp&) = delete;
  AtomicMonotonicElapsedTimestamp& operator=(
      const AtomicMonotonicElapsedTimestamp&) = delete;

  void store(
      int64_t wallTime,
      std::memory_order order = std::memory_order_seq_cst) noexcept {
    if (wallTime <= 0) {
      wallTime_.store(0, order);
      startedTick_.store(0, std::memory_order_relaxed);
      return;
    }
    const uint64_t nowTick = GetTickCount64();
    startedTick_.store(nowTick == 0 ? 1 : nowTick, std::memory_order_relaxed);
    wallTime_.store(wallTime, order);
  }

  [[nodiscard]] int64_t load(
      std::memory_order order = std::memory_order_seq_cst) const noexcept {
    const int64_t wallTime = wallTime_.load(order);
    const uint64_t startedTick = startedTick_.load(std::memory_order_acquire);
    if (wallTime <= 0 || startedTick == 0) return 0;
    const uint64_t nowTick = GetTickCount64();
    const uint64_t elapsed = nowTick >= startedTick ? nowTick - startedTick : 0;
    const int64_t wallNow = UnixMillis();
    if (wallNow <= 1 || elapsed >= static_cast<uint64_t>(wallNow - 1)) return 1;
    return wallNow - static_cast<int64_t>(elapsed);
  }

 private:
  std::atomic<int64_t> wallTime_{0};
  std::atomic<uint64_t> startedTick_{0};
};

// Converts an assigned UTC deadline into an uptime deadline once. Subsequent
// clock corrections cannot make a startup watchdog fire early or stall.
class MonotonicDeadline {
 public:
  MonotonicDeadline() noexcept = default;

  MonotonicDeadline& operator=(int64_t wallDeadline) noexcept {
    wallDeadline_ = wallDeadline;
    if (wallDeadline <= 0) {
      deadlineTick_ = 0;
      return *this;
    }
    deadlineTick_ = TickForWallDeadline(wallDeadline);
    return *this;
  }

  [[nodiscard]] bool Active() const noexcept { return deadlineTick_ != 0; }
  [[nodiscard]] bool Reached() const noexcept {
    return Active() && GetTickCount64() >= deadlineTick_;
  }
  [[nodiscard]] int64_t RemainingMilliseconds() const noexcept {
    if (!Active()) return 0;
    const uint64_t nowTick = GetTickCount64();
    const uint64_t remaining = deadlineTick_ > nowTick ? deadlineTick_ - nowTick : 0;
    return remaining > static_cast<uint64_t>(INT64_MAX)
        ? INT64_MAX
        : static_cast<int64_t>(remaining);
  }
  [[nodiscard]] int64_t ProjectedWallDeadline() const noexcept {
    if (!Active()) return 0;
    const int64_t wallNow = UnixMillis();
    const int64_t remaining = RemainingMilliseconds();
    return remaining > INT64_MAX - wallNow ? INT64_MAX : wallNow + remaining;
  }

  operator int64_t() const noexcept { return wallDeadline_; }

  friend bool operator>=(int64_t, const MonotonicDeadline& deadline) noexcept {
    return deadline.Reached();
  }

  // ScheduleRecreate keeps the earliest pending request. Compare candidate and
  // current deadlines in uptime space so an OS clock correction between two
  // failures cannot replace an earlier retry with a later one.
  friend bool operator<(
      int64_t candidateWallDeadline,
      const MonotonicDeadline& current) noexcept {
    return !current.Active() ||
        TickForWallDeadline(candidateWallDeadline) < current.deadlineTick_;
  }

 private:
  [[nodiscard]] static uint64_t TickForWallDeadline(
      int64_t wallDeadline) noexcept {
    const int64_t wallNow = UnixMillis();
    const uint64_t delay = wallDeadline > wallNow
        ? static_cast<uint64_t>(wallDeadline - wallNow)
        : 0;
    const uint64_t nowTick = GetTickCount64();
    uint64_t deadlineTick = delay > UINT64_MAX - nowTick
        ? UINT64_MAX
        : nowTick + delay;
    if (deadlineTick == 0) deadlineTick = 1;
    return deadlineTick;
  }

  int64_t wallDeadline_ = 0;
  uint64_t deadlineTick_ = 0;
};

// Operational deadlines do not need the originally assigned civil timestamp.
// Expose a freshly projected wall deadline so the App scheduler can keep using
// its existing UTC interface while the actual wait remains based on uptime.
class MonotonicProjectedDeadline {
 public:
  MonotonicProjectedDeadline() noexcept = default;

  MonotonicProjectedDeadline& operator=(int64_t wallDeadline) noexcept {
    deadline_ = wallDeadline;
    return *this;
  }

  [[nodiscard]] bool Active() const noexcept { return deadline_.Active(); }
  [[nodiscard]] bool Reached() const noexcept { return deadline_.Reached(); }
  operator int64_t() const noexcept { return deadline_.ProjectedWallDeadline(); }

 private:
  MonotonicDeadline deadline_;
};

// The ordinary scheduler may sleep for minutes after a stable document. During
// controller creation, delayed recreation, required-script registration, or
// auth-controller creation, expose an immediate wake so watchdog and recovery
// deadlines are evaluated on each App foreground tick.
class StartupAwareWakeDeadline {
 public:
  StartupAwareWakeDeadline(
      const std::atomic<bool>& creating,
      const std::atomic<bool>& recreating,
      const MonotonicDeadline& startupScriptDeadline,
      const MonotonicElapsedTimestamp& authControllerStartedAt,
      const bool& startupNavigationStarted) noexcept
      : creating_(&creating),
        recreating_(&recreating),
        startupScriptDeadline_(&startupScriptDeadline),
        authControllerStartedAt_(&authControllerStartedAt),
        startupNavigationStarted_(&startupNavigationStarted) {}

  StartupAwareWakeDeadline& operator=(int64_t value) noexcept {
    value_ = value;
    return *this;
  }

  operator int64_t() const noexcept {
    const bool startupWatchdogPending =
        creating_->load(std::memory_order_relaxed) ||
        recreating_->load(std::memory_order_relaxed) ||
        (!*startupNavigationStarted_ && startupScriptDeadline_->Active()) ||
        authControllerStartedAt_->Active();
    return startupWatchdogPending ? 0 : static_cast<int64_t>(value_);
  }

 private:
  const std::atomic<bool>* creating_;
  const std::atomic<bool>* recreating_;
  const MonotonicDeadline* startupScriptDeadline_;
  const MonotonicElapsedTimestamp* authControllerStartedAt_;
  const bool* startupNavigationStarted_;
  MonotonicProjectedDeadline value_;
};

}  // namespace hp
