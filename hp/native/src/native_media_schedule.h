#pragma once

namespace hp {
// Actual power-saving state, independent of dashboard/monitor visibility.
void SetNativeMediaPowerSavingMode(bool enabled) noexcept;
}  // namespace hp
