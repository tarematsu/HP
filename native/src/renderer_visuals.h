#pragma once
#include "common.h"
#include "renderer_theme.h"

namespace hp::visual {
struct Context {
  ID2D1DeviceContext5* target = nullptr;
  ID2D1Factory1* factory = nullptr;
  ID2D1SolidColorBrush* solid = nullptr;
  ID2D1SolidColorBrush* border = nullptr;
};

struct PanelStyle {
  PanelIcon icon = PanelIcon::Settings;
  D2D1_COLOR_F accent = theme::Cyan;
};

PanelStyle StyleForTitle(const std::wstring& title);
void BeginTransition();
void BeginWindowTransition(HWND window);
bool TransitionActive();
float TransitionProgress();
void DrawBackground(const Context& context, float width, float height);
void FillGradientRounded(const Context& context, const D2D1_RECT_F& rect, float radius,
                         D2D1_COLOR_F top, D2D1_COLOR_F bottom);
void DrawSoftShadow(const Context& context, const D2D1_RECT_F& rect, float radius, float strength = 1.0f);
void DrawIcon(const Context& context, PanelIcon icon, D2D1_POINT_2F center, float size,
              D2D1_COLOR_F color);
void DrawPillSurface(const Context& context, const D2D1_RECT_F& rect, D2D1_COLOR_F accent,
                     bool emphasized = false);
void DrawMetricSurface(const Context& context, const D2D1_RECT_F& rect, D2D1_COLOR_F accent);
void DrawProgressBar(const Context& context, const D2D1_RECT_F& rect, float fraction,
                     D2D1_COLOR_F accent);
void DrawStatusDot(const Context& context, D2D1_POINT_2F center, float radius,
                   D2D1_COLOR_F color, bool active = false);
void DrawAreaSeries(const Context& context, const D2D1_RECT_F& area,
                    const std::vector<D2D1_POINT_2F>& points, D2D1_COLOR_F accent);
void DrawPanelShimmer(const Context& context, const D2D1_RECT_F& rect, float radius,
                      D2D1_COLOR_F accent);
}  // namespace hp::visual
