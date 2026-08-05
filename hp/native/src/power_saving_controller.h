#pragma once
#include "common.h"

namespace hp {

class PowerSavingController {
 public:
  PowerSavingController();
  ~PowerSavingController();

  PowerSavingController(const PowerSavingController&) = delete;
  PowerSavingController& operator=(const PowerSavingController&) = delete;

  void InstallForCurrentThread();
  void Uninstall() noexcept;

 private:
  struct BrightnessState;

  static constexpr UINT_PTR kScheduleTimer = 1;
  static constexpr UINT kRaiseOverlayMessage = WM_APP + 1;

  static LRESULT CALLBACK CallWndProc(int code, WPARAM wParam, LPARAM lParam);
  static LRESULT CALLBACK OverlayWndProc(
      HWND window, UINT message, WPARAM wParam, LPARAM lParam);

  void ObserveMessage(const CWPSTRUCT& message);
  void Attach(HWND parent);
  void Detach() noexcept;
  void EnsureOverlay();
  void CheckSchedule(bool force = false);
  void ArmScheduleTimer();
  void ApplyMode(bool enabled);
  void ApplyMinimumBrightness() noexcept;
  void RestoreBrightness() noexcept;
  void RefreshMinimumBrightness() noexcept;
  void LayoutOverlay();
  void PaintOverlay(HWND window);
  RECT ParentButtonRect() const;
  RECT LocalButtonRect() const;

  HHOOK hook_ = nullptr;
  HWND parent_ = nullptr;
  HWND overlay_ = nullptr;
  bool powerSaving_ = false;
  bool scheduleInitialized_ = false;
  int64_t nextScheduleBoundaryAt_ = 0;
  std::unique_ptr<BrightnessState> brightnessState_;

  inline static thread_local PowerSavingController* current_ = nullptr;
};

}  // namespace hp
