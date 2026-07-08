#include "renderer_visuals.h"

namespace hp::visual {
namespace {
std::atomic<uint64_t> gTransitionStartedAt{0};
constexpr uint64_t kTransitionDurationMs = 720;

D2D1_RECT_F Expand(const D2D1_RECT_F& rect, float amount) {
  return D2D1::RectF(rect.left - amount, rect.top - amount,
                     rect.right + amount, rect.bottom + amount);
}

void SetSolid(const Context& context, D2D1_COLOR_F color) {
  if (!context.solid) return;
  context.solid->SetColor(color);
}

ComPtr<ID2D1GradientStopCollection> Stops(const Context& context,
                                          const std::vector<D2D1_GRADIENT_STOP>& values) {
  ComPtr<ID2D1GradientStopCollection> collection;
  if (!context.target || values.empty()) return collection;
  context.target->CreateGradientStopCollection(
      values.data(), static_cast<UINT32>(values.size()),
      D2D1_GAMMA_2_2, D2D1_EXTEND_MODE_CLAMP, &collection);
  return collection;
}

void DrawLightning(const Context& context, D2D1_POINT_2F center, float size,
                   D2D1_COLOR_F color) {
  if (!context.factory || !context.target) return;
  ComPtr<ID2D1PathGeometry> geometry;
  if (FAILED(context.factory->CreatePathGeometry(&geometry))) return;
  ComPtr<ID2D1GeometrySink> sink;
  if (FAILED(geometry->Open(&sink))) return;
  const float x = center.x;
  const float y = center.y;
  sink->BeginFigure(D2D1::Point2F(x + size * .08f, y - size * .52f),
                    D2D1_FIGURE_BEGIN_FILLED);
  sink->AddLine(D2D1::Point2F(x - size * .34f, y + size * .02f));
  sink->AddLine(D2D1::Point2F(x - size * .04f, y + size * .02f));
  sink->AddLine(D2D1::Point2F(x - size * .16f, y + size * .52f));
  sink->AddLine(D2D1::Point2F(x + size * .36f, y - size * .10f));
  sink->AddLine(D2D1::Point2F(x + size * .08f, y - size * .10f));
  sink->EndFigure(D2D1_FIGURE_END_CLOSED);
  sink->Close();
  SetSolid(context, color);
  context.target->FillGeometry(geometry.Get(), context.solid);
}
}  // namespace

PanelStyle StyleForTitle(const std::wstring& title) {
  if (title == L"Spotify") return {PanelIcon::Music, theme::Spotify};
  if (title == L"ニュース") return {PanelIcon::News, theme::Blue};
  if (title == L"CO2") return {PanelIcon::Air, theme::Green};
  if (title == L"SwitchBot") return {PanelIcon::Home, theme::Purple};
  if (title == L"Octopus Energy") return {PanelIcon::Energy, theme::Yellow};
  if (title == L"雨雲レーダー") return {PanelIcon::Radar, theme::Cyan};
  if (title == L"操作") return {PanelIcon::Settings, theme::TextSecondary};
  return {PanelIcon::Weather, theme::Cyan};
}

void BeginTransition() {
  gTransitionStartedAt.store(GetTickCount64(), std::memory_order_relaxed);
}

bool TransitionActive() {
  const uint64_t started = gTransitionStartedAt.load(std::memory_order_relaxed);
  return started != 0 && GetTickCount64() - started < kTransitionDurationMs;
}

float TransitionProgress() {
  const uint64_t started = gTransitionStartedAt.load(std::memory_order_relaxed);
  if (started == 0) return 1.0f;
  const float linear = std::clamp(
      static_cast<float>(GetTickCount64() - started) /
          static_cast<float>(kTransitionDurationMs),
      0.0f, 1.0f);
  return linear * linear * (3.0f - 2.0f * linear);
}

void FillGradientRounded(const Context& context, const D2D1_RECT_F& rect,
                         float radius, D2D1_COLOR_F top,
                         D2D1_COLOR_F bottom) {
  if (!context.target) return;
  auto collection = Stops(context, {{0.0f, top}, {1.0f, bottom}});
  if (!collection) return;
  D2D1_LINEAR_GRADIENT_BRUSH_PROPERTIES properties{};
  properties.startPoint = D2D1::Point2F(rect.left, rect.top);
  properties.endPoint = D2D1::Point2F(rect.left, rect.bottom);
  D2D1_BRUSH_PROPERTIES brushProperties{};
  brushProperties.opacity = 1.0f;
  brushProperties.transform = D2D1::Matrix3x2F::Identity();
  ComPtr<ID2D1LinearGradientBrush> brush;
  if (SUCCEEDED(context.target->CreateLinearGradientBrush(
          &properties, &brushProperties, collection.Get(), &brush))) {
    context.target->FillRoundedRectangle(
        D2D1::RoundedRect(rect, radius, radius), brush.Get());
  }
}

void DrawSoftShadow(const Context& context, const D2D1_RECT_F& rect,
                    float radius, float strength) {
  if (!context.target || !context.solid) return;
  const std::array<std::pair<float, float>, 4> layers{{
      {2.0f, .070f}, {4.0f, .045f}, {7.0f, .026f}, {11.0f, .012f}}};
  for (const auto& [spread, alpha] : layers) {
    SetSolid(context, D2D1::ColorF(0x000000, alpha * strength));
    context.target->FillRoundedRectangle(
        D2D1::RoundedRect(Expand(rect, spread), radius + spread,
                          radius + spread),
        context.solid);
  }
}

void DrawBackground(const Context& context, float width, float height) {
  if (!context.target) return;
  FillGradientRounded(context, D2D1::RectF(0, 0, width, height), 0,
                      theme::BackgroundTop, theme::BackgroundBottom);

  const std::array<std::tuple<D2D1_POINT_2F, D2D1_COLOR_F, float>, 3> glows{{
      {D2D1::Point2F(width * .18f, height * .16f), theme::Alpha(theme::Blue, .11f), width * .42f},
      {D2D1::Point2F(width * .78f, height * .38f), theme::Alpha(theme::Purple, .075f), width * .36f},
      {D2D1::Point2F(width * .50f, height * .94f), theme::Alpha(theme::Cyan, .055f), width * .44f},
  }};

  for (const auto& [center, color, radius] : glows) {
    auto collection = Stops(context, {{0.0f, color}, {1.0f, theme::Alpha(color, 0.0f)}});
    if (!collection) continue;
    D2D1_RADIAL_GRADIENT_BRUSH_PROPERTIES properties{};
    properties.center = center;
    properties.gradientOriginOffset = D2D1::Point2F(0, 0);
    properties.radiusX = radius;
    properties.radiusY = radius * .72f;
    D2D1_BRUSH_PROPERTIES brushProperties{};
    brushProperties.opacity = 1.0f;
    brushProperties.transform = D2D1::Matrix3x2F::Identity();
    ComPtr<ID2D1RadialGradientBrush> brush;
    if (SUCCEEDED(context.target->CreateRadialGradientBrush(
            &properties, &brushProperties, collection.Get(), &brush))) {
      context.target->FillRectangle(D2D1::RectF(0, 0, width, height), brush.Get());
    }
  }

  if (context.solid) {
    SetSolid(context, D2D1::ColorF(0xffffff, .018f));
    for (float y = 20; y < height; y += 54) {
      for (float x = 22 + std::fmod(y, 108.0f) * .2f; x < width; x += 64) {
        context.target->FillEllipse(D2D1::Ellipse(D2D1::Point2F(x, y), 1.0f, 1.0f), context.solid);
      }
    }
  }
}

void DrawPillSurface(const Context& context, const D2D1_RECT_F& rect,
                     D2D1_COLOR_F accent, bool emphasized) {
  const float radius = (rect.bottom - rect.top) * .5f;
  FillGradientRounded(context, rect, radius,
                      theme::Alpha(accent, emphasized ? .28f : .16f),
                      theme::Alpha(accent, emphasized ? .12f : .06f));
  if (context.target && context.solid) {
    SetSolid(context, theme::Alpha(accent, emphasized ? .58f : .34f));
    context.target->DrawRoundedRectangle(D2D1::RoundedRect(rect, radius, radius),
                                         context.solid, 1.0f);
  }
}

void DrawMetricSurface(const Context& context, const D2D1_RECT_F& rect,
                       D2D1_COLOR_F accent) {
  DrawSoftShadow(context, rect, theme::CardRadius, .45f);
  FillGradientRounded(context, rect, theme::CardRadius,
                      theme::CardTop, theme::CardBottom);
  if (!context.target || !context.solid) return;
  SetSolid(context, theme::Alpha(accent, .75f));
  context.target->FillRoundedRectangle(
      D2D1::RoundedRect(D2D1::RectF(rect.left, rect.top + 8,
                                    rect.left + 3, rect.bottom - 8),
                        2, 2), context.solid);
  SetSolid(context, theme::Border);
  context.target->DrawRoundedRectangle(
      D2D1::RoundedRect(rect, theme::CardRadius, theme::CardRadius),
      context.solid, 1.0f);
}

void DrawProgressBar(const Context& context, const D2D1_RECT_F& rect,
                     float fraction, D2D1_COLOR_F accent) {
  if (!context.target || !context.solid) return;
  fraction = std::clamp(fraction, 0.0f, 1.0f);
  const float radius = (rect.bottom - rect.top) * .5f;
  SetSolid(context, D2D1::ColorF(0xffffff, .075f));
  context.target->FillRoundedRectangle(D2D1::RoundedRect(rect, radius, radius), context.solid);
  if (fraction <= 0.0f) return;
  const D2D1_RECT_F fill{rect.left, rect.top,
                         rect.left + std::max(rect.bottom - rect.top,
                                              (rect.right - rect.left) * fraction),
                         rect.bottom};
  FillGradientRounded(context, fill, radius, theme::Alpha(accent, .95f),
                      theme::Alpha(accent, .55f));
}

void DrawStatusDot(const Context& context, D2D1_POINT_2F center, float radius,
                   D2D1_COLOR_F color, bool active) {
  if (!context.target || !context.solid) return;
  if (active) {
    const float pulse = .5f + .5f * std::sin(static_cast<float>(GetTickCount64()) / 210.0f);
    SetSolid(context, theme::Alpha(color, .08f + pulse * .10f));
    context.target->FillEllipse(D2D1::Ellipse(center, radius * (2.0f + pulse * .5f),
                                              radius * (2.0f + pulse * .5f)), context.solid);
  }
  SetSolid(context, theme::Alpha(color, .20f));
  context.target->FillEllipse(D2D1::Ellipse(center, radius * 1.55f, radius * 1.55f), context.solid);
  SetSolid(context, color);
  context.target->FillEllipse(D2D1::Ellipse(center, radius, radius), context.solid);
}

void DrawAreaSeries(const Context& context, const D2D1_RECT_F& area,
                    const std::vector<D2D1_POINT_2F>& points,
                    D2D1_COLOR_F accent) {
  if (!context.target || !context.factory || points.size() < 2) return;

  ComPtr<ID2D1PathGeometry> fillGeometry;
  ComPtr<ID2D1PathGeometry> lineGeometry;
  if (FAILED(context.factory->CreatePathGeometry(&fillGeometry)) ||
      FAILED(context.factory->CreatePathGeometry(&lineGeometry))) return;

  ComPtr<ID2D1GeometrySink> fillSink;
  ComPtr<ID2D1GeometrySink> lineSink;
  if (FAILED(fillGeometry->Open(&fillSink)) || FAILED(lineGeometry->Open(&lineSink))) return;

  fillSink->BeginFigure(D2D1::Point2F(points.front().x, area.bottom), D2D1_FIGURE_BEGIN_FILLED);
  fillSink->AddLine(points.front());
  for (size_t index = 1; index < points.size(); ++index) fillSink->AddLine(points[index]);
  fillSink->AddLine(D2D1::Point2F(points.back().x, area.bottom));
  fillSink->EndFigure(D2D1_FIGURE_END_CLOSED);
  fillSink->Close();

  lineSink->BeginFigure(points.front(), D2D1_FIGURE_BEGIN_HOLLOW);
  for (size_t index = 1; index < points.size(); ++index) lineSink->AddLine(points[index]);
  lineSink->EndFigure(D2D1_FIGURE_END_OPEN);
  lineSink->Close();

  auto collection = Stops(context, {{0.0f, theme::Alpha(accent, .30f)},
                                     {1.0f, theme::Alpha(accent, .018f)}});
  if (collection) {
    D2D1_LINEAR_GRADIENT_BRUSH_PROPERTIES properties{};
    properties.startPoint = D2D1::Point2F(area.left, area.top);
    properties.endPoint = D2D1::Point2F(area.left, area.bottom);
    D2D1_BRUSH_PROPERTIES brushProperties{};
    brushProperties.opacity = 1.0f;
    brushProperties.transform = D2D1::Matrix3x2F::Identity();
    ComPtr<ID2D1LinearGradientBrush> gradient;
    if (SUCCEEDED(context.target->CreateLinearGradientBrush(
            &properties, &brushProperties, collection.Get(), &gradient))) {
      context.target->FillGeometry(fillGeometry.Get(), gradient.Get());
    }
  }

  if (context.solid) {
    SetSolid(context, accent);
    context.target->DrawGeometry(lineGeometry.Get(), context.solid, 2.2f);
    for (const auto& point : points) {
      SetSolid(context, theme::Alpha(accent, .18f));
      context.target->FillEllipse(D2D1::Ellipse(point, 5.0f, 5.0f), context.solid);
      SetSolid(context, accent);
      context.target->FillEllipse(D2D1::Ellipse(point, 2.1f, 2.1f), context.solid);
    }
  }
}

void DrawPanelShimmer(const Context& context, const D2D1_RECT_F& rect,
                      float radius, D2D1_COLOR_F accent) {
  (void)radius;
  if (!TransitionActive() || !context.target) return;
  const float progress = TransitionProgress();
  const float width = rect.right - rect.left;
  const float center = rect.left - 70.0f + (width + 140.0f) * progress;
  const D2D1_RECT_F shine{center - 34.0f, rect.top, center + 34.0f, rect.bottom};
  auto collection = Stops(context, {
      {0.0f, theme::Alpha(accent, 0.0f)},
      {.50f, theme::Alpha(accent, .13f * (1.0f - progress))},
      {1.0f, theme::Alpha(accent, 0.0f)},
  });
  if (!collection) return;
  D2D1_LINEAR_GRADIENT_BRUSH_PROPERTIES properties{};
  properties.startPoint = D2D1::Point2F(shine.left, shine.top);
  properties.endPoint = D2D1::Point2F(shine.right, shine.top);
  D2D1_BRUSH_PROPERTIES brushProperties{};
  brushProperties.opacity = 1.0f;
  brushProperties.transform = D2D1::Matrix3x2F::Identity();
  ComPtr<ID2D1LinearGradientBrush> gradient;
  if (FAILED(context.target->CreateLinearGradientBrush(
          &properties, &brushProperties, collection.Get(), &gradient))) return;
  context.target->PushAxisAlignedClip(rect, D2D1_ANTIALIAS_MODE_PER_PRIMITIVE);
  context.target->FillRectangle(shine, gradient.Get());
  context.target->PopAxisAlignedClip();
}
}  // namespace hp::visual

// Feature group split out of this file; compiled as part of this translation
// unit so it shares the file-local SetSolid/DrawLightning helpers (unity-build
// pattern, like renderer_core.cpp). Not listed in CMake on purpose.
#include "renderer_visuals_icons.cpp"
