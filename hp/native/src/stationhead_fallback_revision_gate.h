#pragma once

#include "monotonic_time.h"
#include "sh_audio_loss_policy.h"

namespace hp {

class StationheadFallbackRevisionGate {
 public:
  StationheadFallbackRevisionGate& operator=(uint64_t healthyRevision) noexcept {
    if (healthyRevision == 0) {
      Reset();
    } else {
      Arm(healthyRevision);
    }
    return *this;
  }

  friend bool operator>(
      uint64_t healthyRevision,
      const StationheadFallbackRevisionGate& gate) noexcept {
    return gate.CanRelease(healthyRevision);
  }

  void Arm(uint64_t healthyRevision) noexcept {
    baselineHealthyRevision_ = healthyRevision;
    startedAt_ = UnixMillis();
  }

  void Reset() noexcept {
    baselineHealthyRevision_ = 0;
    startedAt_ = 0;
  }

  [[nodiscard]] bool CanRelease(uint64_t healthyRevision) const noexcept {
    return startedAt_.Active() && healthyRevision != 0 &&
        startedAt_.ElapsedMilliseconds() >=
            kStationheadFallbackMinimumDwellMs &&
        healthyRevision > baselineHealthyRevision_;
  }

 private:
  uint64_t baselineHealthyRevision_ = 0;
  MonotonicElapsedTimestamp startedAt_;
};

}  // namespace hp
