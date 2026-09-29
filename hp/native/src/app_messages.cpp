#include "app.h"
#include "app_startup_tick_fallback.h"
#include "spotify_artist_chart_collector.h"
#include "stationhead_leaderboard_capture_spool.h"
#include "web_renderer.h"

namespace hp {
namespace {
constexpr UINT kStationheadHealthUpdatedMessage = WM_APP + 10;
constexpr UINT_PTR kSpotifyArtistChartTimer = 41;
constexpr UINT_PTR kSpotifyArtistChartWatchTimer = 42;
// Creating the extra Spotify Charts controller 250 ms after WM_NCCREATE races
// the dashboard/YouTube WebView2 startup on low-spec tablets. The collector had
// historically been isolated from startup for the same stability reason. Keep
// the temporary visible debug surface, but do not create it until the six media
// profile startup sequence has had time to settle.
constexpr UINT kSpotifyArtistChartInitialDelayMs = 4 * 60 * 1000;
constexpr UINT kSpotifyArtistChartStartupRetryMs = 30 * 1000;
constexpr UINT kSpotifyArtistChartIntervalMs = 60 * 60 * 1000;
constexpr UINT kSpotifyArtistChartWatchMs = 250;
constexpr int64_t kSpotifyArtistChartIdleThresholdMs = 5 * 60'000LL;

SpotifyArtistChartCollector& SpotifyArtistChartCollectorInstance() {
  static SpotifyArtistChartCollector collector;
  return collector;
}

void ArmSpotifyArtistChartInitialTimer(HWND window) {
  if (!window) return;
  SetTimer(window, kSpotifyArtistChartTimer, kSpotifyArtistChartInitialDelayMs, nullptr);
}

void RearmSpotifyArtistChartAfterStartup(HWND window) {
  if (!window) return;
  KillTimer(window, kSpotifyArtistChartTimer);
  SetTimer(window, kSpotifyArtistChartTimer, kSpotifyArtistChartStartupRetryMs, nullptr);
}

void CaptureSpotifyArtistChartHourly(HWND window) {
  if (!window) return;
  KillTimer(window, kSpotifyArtistChartTimer);
  SetTimer(window, kSpotifyArtistChartTimer, kSpotifyArtistChartIntervalMs, nullptr);

  const int64_t now = UnixMillis();
  auto& collector = SpotifyArtistChartCollectorInstance();
  collector.EnsureStarted(now);
  collector.RequestCaptureNow(now);
  collector.Tick(now);
  collector.ShowForDebug();
  SetTimer(window, kSpotifyArtistChartWatchTimer, kSpotifyArtistChartWatchMs, nullptr);
}

void TickSpotifyArtistChartCapture(HWND window) {
  const int64_t now = UnixMillis();
  auto& collector = SpotifyArtistChartCollectorInstance();
  collector.Tick(now);
  collector.ShowForDebug();
  const int64_t nextWake = collector.NextWakeAt();
  if (nextWake <= 0 || nextWake - now > kSpotifyArtistChartIdleThresholdMs) {
    KillTimer(window, kSpotifyArtistChartWatchTimer);
  }
}

void StopSpotifyArtistChartCapture(HWND window) {
  if (window) {
    KillTimer(window, kSpotifyArtistChartTimer);
    KillTimer(window, kSpotifyArtistChartWatchTimer);
  }
  SpotifyArtistChartCollectorInstance().Stop();
}
}

LRESULT CALLBACK App::WindowProc(HWND window, UINT message, WPARAM wParam, LPARAM lParam) {
  App* app = reinterpret_cast<App*>(GetWindowLongPtrW(window, GWLP_USERDATA));
  if (message == WM_NCCREATE) {
    app = static_cast<App*>(reinterpret_cast<CREATESTRUCTW*>(lParam)->lpCreateParams);
    if (app) app->window_ = window;
    SetWindowLongPtrW(window, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(app));
    if (app) {
      StartStartupUpdateFallback(window, app);
      ArmSpotifyArtistChartInitialTimer(window);
    }
  }

  const LRESULT result = app ? app->HandleMessage(message, wParam, lParam)
                             : DefWindowProcW(window, message, wParam, lParam);
  if (message == WM_NCDESTROY) {
    StopSpotifyArtistChartCapture(window);
    StopStartupUpdateFallback();
    SetWindowLongPtrW(window, GWLP_USERDATA, 0);
    if (app) app->window_ = nullptr;
  }
  return result;
}

LRESULT App::HandleMessage(UINT message, WPARAM wParam, LPARAM lParam) {
  switch (message) {
    case WM_TIMER:
      if (wParam == kSpotifyArtistChartTimer) {
        // Do not let the debug collector become the first user of the shared
        // spotify-v2-6 profile. The sixth Stationhead startup owns that profile
        // and is deliberately staged after the other five media windows.
        if (!stationheadStarted_ || !stationheadLeaderboardCollectorStarted_) {
          RearmSpotifyArtistChartAfterStartup(window_);
          return 0;
        }
        CaptureSpotifyArtistChartHourly(window_);
        return 0;
      }
      if (wParam == kSpotifyArtistChartWatchTimer) {
        TickSpotifyArtistChartCapture(window_);
        return 0;
      }
      if (wParam == 0) MarkStationheadPlacementDirty();
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
    case WM_HP_SWITCHBOT_UPDATED:
      if (renderer_) renderer_->LoadSwitchBot(dataDir_ / L"switchbot.json");
      return 0;
    case WM_HP_SENSOR_UPDATED: {
      if (!sensors_ || !renderer_) return 0;
      const SensorSnapshot snapshot = sensors_->Snapshot();
      renderer_->UpdateSensors(snapshot);
      UpdateAirHistory(snapshot);
      return 0;
    }
    case kStationheadLeaderboardCaptureWakeMessage:
      // Leaderboard diagnostics and capture-spool writes share this wake channel.
      // Re-arm the central timer as well as refreshing Cloud so deadlines that are
      // moved earlier by asynchronous WebView2 callbacks are observed promptly.
      ScheduleNextTick(1);
      if (cloud_) cloud_->RefreshNow();
      return 0;

    case WM_HP_PRIMARY_RELOAD_READY:
      return stationhead_ ? 1 : 0;
    case WM_HP_STATIONHEAD_CHANGED: {
      bool handled = false;
      for (size_t i = 0; i < stationheadPeers_.size(); ++i) {
        if (!stationheadPeerStarted_[i] || !stationheadPeers_[i]) continue;
        const uint32_t changes = stationheadPeers_[i]->ConsumeChangeFlags();
        if ((changes & StationheadChangeShowPlayer) != 0) {
          stationheadPeers_[i]->ShowAfterAudioStop();
        }
        handled = true;
      }
      if (stationheadStarted_ && stationhead_) {
        const uint32_t changes = stationhead_->ConsumeChangeFlags();
        if ((changes & StationheadChangeShowPlayer) != 0) {
          stationhead_->ShowAfterAudioStop();
        }
        handled = true;
      }
      if (!handled) return 0;
      MarkStationheadPlacementDirty();
      ApplyStationheadWindowPlacement();
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
