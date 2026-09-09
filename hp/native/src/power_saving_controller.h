#pragma once
#include "common.h"
#include <commctrl.h>

#ifdef _MSC_VER
#pragma comment(lib, "Comctl32.lib")
#endif

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
  static constexpr UINT_PTR kParentSubclassId = 0x48505053;
  static constexpr UINT_PTR kChildSubclassId = 0x48504353;
  static constexpr UINT kRaiseOverlayMessage = WM_APP + 1;

  static LRESULT CALLBACK ParentSubclassProc(
      HWND window, UINT message, WPARAM wParam, LPARAM lParam,
      UINT_PTR subclassId, DWORD_PTR referenceData);
  static LRESULT CALLBACK ChildSubclassProc(
      HWND window, UINT message, WPARAM wParam, LPARAM lParam,
      UINT_PTR subclassId, DWORD_PTR referenceData);
  static LRESULT CALLBACK OverlayWndProc(
      HWND window, UINT message, WPARAM wParam, LPARAM lParam);

  void ObserveParentMessage(UINT message, WPARAM wParam, LPARAM lParam);
  void Attach(HWND parent);
  void AttachChildWindow(HWND window) noexcept;
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
  bool powerSaving_ = false;
  bool mediaMuted_ = false;
  bool mvStartupInputPass_ = false;
  bool scheduleInitialized_ = false;
  int64_t nextScheduleBoundaryAt_ = 0;
  std::unique_ptr<BrightnessState> brightnessState_;

  inline static thread_local PowerSavingController* current_ = nullptr;
};

}  // namespace hp