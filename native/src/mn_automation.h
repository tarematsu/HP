#pragma once
#include "common.h"
#include "logger.h"

namespace hp {

// Called from the primary Stationhead UI-thread tick so WebView2 controller
// creation and script execution stay on the application's message-pump thread.
void TickMineoAutomation(HWND ownerWindow, int64_t nowMs,
                         const fs::path& sharedWebViewDataFolder,
                         Logger& log) noexcept;

// Releases the dedicated profile/controller before the primary WebView shuts down.
void ShutdownMineoAutomation() noexcept;

}  // namespace hp
