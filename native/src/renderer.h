#pragma once
#include "common.h"
#include <array>
#include "dashboard_data.h"
#include "radar.h"
#include "sensors.h"
#include "sh.h"

namespace hp {
enum class UiAction { None, DataRefresh, AppUpdate, Restart, Maintenance, StationheadReconnect, ClearCache, ShowLog, CloseMaintenance, RadarToggle, RadarPrevious, RadarNext, RadarSeek };
struct DiagnosticsState {
  size_t appWorkingSet = 0;
  size_t webViewWorkingSet = 0;
  uint64_t availablePhysical = 0;
  double cpuPercent = 0;
  std::wstring cloudLastSuccess;
  std::wstring workerVersion;
  std::wstring appVersion;
  std::wstring co2LastTime;
  std::wstring stationheadLastTime;
};
struct RenderState {
  SensorSnapshot sensors;
  StationheadStatus stationhead;
  DiagnosticsState diagnostics;
  bool maintenance = false;
  std::wstring toast;
};

class Renderer {
 public:
  Renderer(HWND window, int width, int height, RadarManager& radar);
  void Initialize();
  void Resize(int width, int height);
  bool LoadDashboard(const fs::path& jsonPath);
  void Render(const RECT& dirty, const RenderState& state);
  UiAction HitTest(POINT point, float* seekFraction = nullptr) const;
  RECT ClockRect() const;
  RECT SensorRect() const;
  RECT RadarRect() const;
  RECT StationheadRect() const;

 private:
  void CreateDeviceResources();
  void CreateSizeResources();
  void CreateBrushResources();
  void RecalculateLayout();
  D2D1_MATRIX_3X2_F PanelTransform(size_t index) const;
  D2D1_MATRIX_3X2_F CanvasTransform() const;
  POINT MapPointToPanel(POINT point, size_t index) const;
  POINT MapPointToCanvas(POINT point) const;
  RECT PanelRect(size_t index) const;
  void DrawText(const std::wstring& text, const D2D1_RECT_F& rect, float size, D2D1_COLOR_F color,
                DWRITE_TEXT_ALIGNMENT align = DWRITE_TEXT_ALIGNMENT_LEADING, DWRITE_FONT_WEIGHT weight = DWRITE_FONT_WEIGHT_NORMAL);
  void DrawButton(const D2D1_RECT_F& rect, const std::wstring& label, bool active = false);
  void DrawPanel(const D2D1_RECT_F& rect, const std::wstring& title);
  void DrawPanelStatus(const D2D1_RECT_F& rect, const PanelDataStatus& status, bool hasContent, const std::wstring& waitingText);
  void DrawDashboardBase();
  void DrawNews();
  void DrawWeather();
  void DrawOctopus();
  void DrawSwitchBot();
  void DrawClock();
  void DrawSensors(const SensorSnapshot& sensors);
  void DrawCo2Graph(const std::vector<int>& history);
  void DrawStationhead(const StationheadStatus& status);
  void DrawRadar();
  void DrawButtons(bool maintenance, const std::wstring& toast);
  void DrawDiagnostics(const DiagnosticsState& diagnostics, const SensorSnapshot& sensors, const StationheadStatus& stationhead);

  HWND window_;
  int width_;
  int height_;
  float panelScale_ = 1.0f;
  std::array<D2D1_RECT_F, 9> panels_{};
  RadarManager& radar_;
  DashboardSnapshot dashboard_;
  ComPtr<ID3D11Device> d3dDevice_;
  ComPtr<ID3D11DeviceContext> d3dContext_;
  ComPtr<IDXGISwapChain1> swapChain_;
  ComPtr<ID2D1Factory1> d2dFactory_;
  ComPtr<ID2D1Device> d2dDevice_;
  ComPtr<ID2D1DeviceContext5> context_;
  ComPtr<ID2D1Bitmap1> target_;
  ComPtr<IDWriteFactory> writeFactory_;
  ComPtr<IWICImagingFactory> wic_;
  ComPtr<ID2D1SolidColorBrush> brush_;
  ComPtr<ID2D1SolidColorBrush> buttonFill_;
  ComPtr<ID2D1SolidColorBrush> buttonActiveFill_;
  ComPtr<ID2D1SolidColorBrush> overlayFill_;
  ComPtr<ID2D1SolidColorBrush> borderBrush_;
  std::unordered_map<int, ComPtr<IDWriteTextFormat>> formats_;
  D2D1_RECT_F dataRefresh_{870, 650, 992, 710};
  D2D1_RECT_F appUpdate_{1004, 650, 1126, 710};
  D2D1_RECT_F restart_{1138, 650, 1260, 710};
  D2D1_RECT_F exit_{1073, 728, 1260, 790};
  D2D1_RECT_F maintenance_{870, 728, 1057, 790};
  D2D1_RECT_F spotifyConnect_{960, 244, 1160, 282};
  D2D1_RECT_F stationReconnect_{230, 690, 430, 742};
  D2D1_RECT_F clearCache_{446, 690, 646, 742};
  D2D1_RECT_F showLog_{662, 690, 862, 742};
  D2D1_RECT_F closeMaintenance_{878, 690, 1050, 742};
  D2D1_RECT_F radarPrevious_{446, 828, 482, 866};
  D2D1_RECT_F radarToggle_{488, 828, 548, 866};
  D2D1_RECT_F radarNext_{554, 828, 590, 866};
  D2D1_RECT_F radarSlider_{602, 840, 825, 852};
};
}  // namespace hp
