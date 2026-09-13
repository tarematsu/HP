#include "app.h"
#include "app_startup_tick_fallback.h"
#include "web_renderer.h"

namespace hp {
namespace {
constexpr UINT kStationheadHealthUpdatedMessage = WM_APP + 10;
}

LRESULT CALLBACK App::WindowProc(HWND window, UINT message, WPARAM wParam, LPARAM lParam) {
  App* app = reinterpret_cast<App*>(GetWindowLongPtrW(window, GWLP_USERDATA));
  if (message == WM_NCCREATE) {
    app = static_cast<App*>(reinterpret_cast<CREATESTRUCTW*>(lParam)->lpCreateParams);
    if (app) app->window_ = window;
    SetWindowLongPtrW(window, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(app));
    if (app) StartStartupUpdateFallback(window, app);
  }

  const LRESULT result = app ? app->HandleMessage(message, wParam, lParam)
                             : DefWindowProcW(window, message, wParam, lParam);
  if (message == WM_NCDESTROY) {
    StopStartupUpdateFallback();
    SetWindowLongPtrW(window, GWLP_USERDATA, 0);
    if (app) app->window_ = nullptr;
  }
  return result;
}

void App::ProcessPendingStationheadTrackBoundaryRefreshes(int64_t nowMs) {
  // A single Stationhead player has no peer handoff window to coordinate.
  (void)nowMs;
}

LRESULT App::HandleMessage(UINT message, WPARAM wParam, LPARAM lParam) {
  switch (message) {
    case WM_TIMER:
      Tick();
      return 0;
    case kStartupUpdateWakeMessage:
      HandleStartupUpdateWake();
      return 0;
    case WM_PAINT:
      Draw();
      return 0;
    case WM_ERASEBKGND:
      return 1;
    case WM_SIZE:
      if (renderer_ && wParam != SIZE_MINIMIZED) {
        renderer_->Resize(LOWORD(lParam), HIWORD(lParam));
        LayoutWorkspace();
      }
      return 0;
    case WM_LBUTTONUP:
      if (renderer_) HandleAction(renderer_->TakePendingAction());
      return 0;
    case kRendererActionMessage:
      HandleAction(static_cast<UiAction>(wParam));
      return 0;
    case WM_HP_CLOUD_UPDATED: {
      if (!renderer_) return 0;
      bool dashboardChanged = false;
      if (!renderer_->LoadDashboard(dataDir_ / L"dashboard.json", &dashboardChanged) ||
          !dashboardChanged) {
        return 0;
      }
      ShowToast(L"表示データを更新しました", 4000, false);
      return 0;
    }
    case WM_HP_RADAR_UPDATED:
      if (renderer_) renderer_->NotifyRadarUpdated();
      return 0;
    case WM_HP_SWITCHBOT_UPDATED: {
      if (!sensors_ || !renderer_) return 0;
      sensors_->ApplyCloudSwitchBot(dataDir_ / L"switchbot.json");
      renderer_->UpdateSensors(sensors_->Snapshot());
      return 0;
    }
    case WM_HP_SENSOR_UPDATED: {
      if (!sensors_ || !renderer_) return 0;
      const SensorSnapshot snapshot = sensors_->Snapshot();
      renderer_->UpdateSensors(snapshot);
      UpdateAirHistory(snapshot);
      return 0;
    }

    case WM_HP_PRIMARY_RELOAD_READY:
      // There is no B window to wait for. The single player may refresh as soon
      // as its own track-boundary policy decides a navigation is due.
      return stationhead_ ? 1 : 0;
    case WM_HP_SECONDARY_RELOAD_READY:
      return 0;
    case WM_HP_STATIONHEAD_CHANGED: {
      if (!stationhead_) return 0;
      const uint32_t changes = stationhead_->ConsumeChangeFlags();
      if ((changes & StationheadChangeReleaseAuth) != 0) {
        stationhead_->ReleaseCompletedAuth();
      }
      if ((changes & StationheadChangeShowPlayer) != 0) {
        stationhead_->ShowAfterAudioStop();
      }
      MarkStationheadPlacementDirty();
      ApplyStationheadWindowPlacement(stationhead_->Status(), StationheadStatus{});
      ScheduleNextTick(1);
      return 0;
    }
    case kStationheadHealthUpdatedMessage:
      if (cloud_ && toastUntil_ == 0) {
        std::wstring health = cloud_->StationheadHealthText();
        if (toastText_ != health) ShowToast(std::move(health), 0, false);
      }
      return 0;

    case WM_HP_CONFIG_UPDATED:
      ShowToast(L"クラウド設定を保存しました。再起動時に適用します", 5000);
      return 0;
    case WM_HP_COMMANDS_UPDATED:
      ProcessRemoteCommands();
      return 0;
    case kUpdateResultMessage: {
      std::unique_ptr<wchar_t[]> updateMessage(reinterpret_cast<wchar_t*>(lParam));
      if (updateMessage && updateMessage[0] != L'\0') {
        ShowToast(updateMessage.get(), 7000);
      }
      return 0;
    }
    case WM_CLOSE:
      DestroyWindow(window_);
      return 0;
    case WM_DESTROY:
      PostQuitMessage(exitCode_);
      return 0;
  }
  return DefWindowProcW(window_, message, wParam, lParam);
}

}  // namespace hp
