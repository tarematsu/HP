// Part of renderer_visuals.cpp's translation unit (see the #include at the end
// of that file). Vector panel-icon rendering. Uses the SetSolid / DrawLightning
// helpers defined in renderer_visuals.cpp.
#include "renderer_visuals.h"

namespace hp::visual {

void DrawIcon(const Context& context, PanelIcon icon, D2D1_POINT_2F center,
              float size, D2D1_COLOR_F color) {
  if (!context.target || !context.solid) return;
  SetSolid(context, color);
  const float half = size * .5f;
  const float stroke = std::max(1.25f, size * .085f);

  switch (icon) {
    case PanelIcon::Music:
      context.target->DrawLine(D2D1::Point2F(center.x + half * .18f, center.y - half * .50f),
                               D2D1::Point2F(center.x + half * .18f, center.y + half * .28f),
                               context.solid, stroke);
      context.target->DrawLine(D2D1::Point2F(center.x + half * .18f, center.y - half * .50f),
                               D2D1::Point2F(center.x + half * .62f, center.y - half * .36f),
                               context.solid, stroke);
      context.target->FillEllipse(D2D1::Ellipse(D2D1::Point2F(center.x - half * .04f, center.y + half * .38f),
                                                half * .34f, half * .25f), context.solid);
      break;
    case PanelIcon::News:
      context.target->DrawRoundedRectangle(D2D1::RoundedRect(
          D2D1::RectF(center.x - half * .65f, center.y - half * .58f,
                      center.x + half * .65f, center.y + half * .58f),
          size * .08f, size * .08f), context.solid, stroke);
      context.target->FillRectangle(D2D1::RectF(center.x - half * .48f, center.y - half * .35f,
                                                center.x - half * .12f, center.y + half * .05f), context.solid);
      for (int row = 0; row < 3; ++row) {
        const float y = center.y - half * .28f + row * half * .30f;
        context.target->DrawLine(D2D1::Point2F(center.x + half * .02f, y),
                                 D2D1::Point2F(center.x + half * .46f, y), context.solid, stroke * .65f);
      }
      break;
    case PanelIcon::Air:
      context.target->DrawEllipse(D2D1::Ellipse(center, half * .34f, half * .34f), context.solid, stroke);
      context.target->DrawEllipse(D2D1::Ellipse(center, half * .62f, half * .62f), context.solid, stroke * .65f);
      context.target->DrawLine(D2D1::Point2F(center.x - half * .72f, center.y),
                               D2D1::Point2F(center.x - half * .40f, center.y), context.solid, stroke);
      context.target->DrawLine(D2D1::Point2F(center.x + half * .40f, center.y),
                               D2D1::Point2F(center.x + half * .72f, center.y), context.solid, stroke);
      break;
    case PanelIcon::Weather:
      context.target->DrawEllipse(D2D1::Ellipse(D2D1::Point2F(center.x - half * .18f, center.y - half * .20f),
                                                half * .32f, half * .32f), context.solid, stroke);
      for (int ray = 0; ray < 6; ++ray) {
        const float angle = static_cast<float>(ray) * 3.14159265f / 3.0f;
        context.target->DrawLine(
            D2D1::Point2F(center.x - half * .18f + std::cos(angle) * half * .43f,
                          center.y - half * .20f + std::sin(angle) * half * .43f),
            D2D1::Point2F(center.x - half * .18f + std::cos(angle) * half * .60f,
                          center.y - half * .20f + std::sin(angle) * half * .60f),
            context.solid, stroke * .65f);
      }
      context.target->DrawLine(D2D1::Point2F(center.x - half * .46f, center.y + half * .39f),
                               D2D1::Point2F(center.x + half * .52f, center.y + half * .39f),
                               context.solid, stroke * 1.2f);
      break;
    case PanelIcon::Home:
      context.target->DrawLine(D2D1::Point2F(center.x - half * .66f, center.y - half * .02f),
                               D2D1::Point2F(center.x, center.y - half * .62f), context.solid, stroke);
      context.target->DrawLine(D2D1::Point2F(center.x, center.y - half * .62f),
                               D2D1::Point2F(center.x + half * .66f, center.y - half * .02f), context.solid, stroke);
      context.target->DrawRectangle(D2D1::RectF(center.x - half * .46f, center.y - half * .02f,
                                                center.x + half * .46f, center.y + half * .58f),
                                    context.solid, stroke);
      break;
    case PanelIcon::Energy:
      DrawLightning(context, center, size, color);
      break;
    case PanelIcon::Radar:
      context.target->DrawEllipse(D2D1::Ellipse(center, half * .62f, half * .62f), context.solid, stroke * .75f);
      context.target->DrawEllipse(D2D1::Ellipse(center, half * .34f, half * .34f), context.solid, stroke * .60f);
      context.target->DrawLine(center, D2D1::Point2F(center.x + half * .48f, center.y - half * .36f),
                               context.solid, stroke);
      context.target->FillEllipse(D2D1::Ellipse(center, half * .09f, half * .09f), context.solid);
      break;
    case PanelIcon::Settings:
      context.target->DrawEllipse(D2D1::Ellipse(center, half * .34f, half * .34f), context.solid, stroke);
      for (int spoke = 0; spoke < 8; ++spoke) {
        const float angle = static_cast<float>(spoke) * 3.14159265f / 4.0f;
        context.target->DrawLine(
            D2D1::Point2F(center.x + std::cos(angle) * half * .45f,
                          center.y + std::sin(angle) * half * .45f),
            D2D1::Point2F(center.x + std::cos(angle) * half * .68f,
                          center.y + std::sin(angle) * half * .68f),
            context.solid, stroke);
      }
      break;
  }
}

}  // namespace hp::visual
