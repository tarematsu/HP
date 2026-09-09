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
  static void AttachCurrent(HWND parent);

 private:
  struct BrightnessState;

  static constexpr UINT_PTR kScheduleTimer = 1;
  static constexpr UINT_PTR kMvStartupPassTimer = 2;
  static constexpr UINT kRaiseOverlayMessage = WM_APP + 1;

  static LRESULT CALLBACK ParentWndProc(
      HWND window, UINT message, WPARAM wParam, LPARAM lParam);
  static LRESULT CALLBACK MvWndProc(
      HWND window, UINT message, WPARAM wParam, LPARAM lParam);
  static LRESULT CALLBACK OverlayWndProc(
      HWND window, UINT message, WPARAM wParam, LPARAM lParam);

  void ObserveParentMessage(UINT message, WPARAM wParam, LPARAM lParam);
  void Attach(HWND parent);
  void AttachMvWindow(HWND window) noexcept;
  void DetachMvWindow() noexcept;
  void Detach() noexcept;
  void EnsureOverlay();
  void CheckSchedule(bool force = false);
  void ArmScheduleTimer();
  void OpenMvStartupInputPass();
  void CloseMvStartupInputPass();
  void ApplyMode(bool enabled);
  void ApplyMediaMute(bool enabled) noexcept;
  void ApplyMinimumBrightness() noexcept;
  void RestoreBrightness() noexcept;
  void RefreshMinimumBrightness() noexcept;
  void LayoutOverlay();
  void PaintOverlay(HWND window);
  RECT ParentControlStackRect() const;
  RECT LocalPowerButtonRect() const;
  RECT LocalMuteButtonRect() const;

  HWND parent_ = nullptr;
  HWND overlay_ = nullptr;
  HWND mvWindow_ = nullptr;
  WNDPROC parentWndProc_ = nullptr;
  WNDPROC mvWndProc_ = nullptr;
  bool powerSaving_ = false;
  bool mediaMuted_ = false;
  bool mvStartupInputPass_ = false;
  bool scheduleInitialized_ = false;
  int64_t nextScheduleBoundaryAt_ = 0;
  std::unique_ptr<BrightnessState> brightnessState_;

  inline static thread_local PowerSavingController* current_ = nullptr;
};

}  // namespace hp