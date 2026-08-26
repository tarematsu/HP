#pragma once

#include "common.h"

namespace hp {

// Starts the low-latency earthquake warning receiver and JMA typhoon watcher.
// The alert UI is implemented as native child windows so it can cover the
// entire HomePanel surface without depending on WebView rendering.
void StartWeatherAlerts(HWND parentWindow, HWND radarWindow) noexcept;
void RefreshWeatherAlertLayout() noexcept;
void StopWeatherAlerts() noexcept;

}  // namespace hp
