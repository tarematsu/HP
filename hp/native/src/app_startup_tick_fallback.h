#pragma once
#include "common.h"

namespace hp {

class App;

inline constexpr UINT kStartupUpdateWakeMessage = WM_APP + 21;

void StartStartupUpdateFallback(HWND window, App* owner) noexcept;
void CompleteStartupUpdateFallback() noexcept;
void StopStartupUpdateFallback() noexcept;

}  // namespace hp
