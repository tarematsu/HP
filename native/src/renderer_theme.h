#pragma once
#include "common.h"

namespace hp {
enum class PanelIcon {
  Music,
  News,
  Air,
  Weather,
  Home,
  Energy,
  Radar,
  Settings,
};

namespace theme {
inline const D2D1_COLOR_F BackgroundTop = D2D1::ColorF(0x07111c, .24f);
inline const D2D1_COLOR_F BackgroundBottom = D2D1::ColorF(0x03070d, .12f);
inline const D2D1_COLOR_F PanelTop = D2D1::ColorF(0x182331, .96f);
inline const D2D1_COLOR_F PanelBottom = D2D1::ColorF(0x0c131d, .96f);
inline const D2D1_COLOR_F CardTop = D2D1::ColorF(0x1b2938, .82f);
inline const D2D1_COLOR_F CardBottom = D2D1::ColorF(0x111a25, .82f);
inline const D2D1_COLOR_F TextPrimary = D2D1::ColorF(0xf4f7fa);
inline const D2D1_COLOR_F TextSecondary = D2D1::ColorF(0xaab7c6);
inline const D2D1_COLOR_F TextMuted = D2D1::ColorF(0x718093);
inline const D2D1_COLOR_F Border = D2D1::ColorF(0xffffff, .12f);
inline const D2D1_COLOR_F Highlight = D2D1::ColorF(0xffffff, .16f);
inline const D2D1_COLOR_F Cyan = D2D1::ColorF(0x66d6ff);
inline const D2D1_COLOR_F Blue = D2D1::ColorF(0x6798ff);
inline const D2D1_COLOR_F Green = D2D1::ColorF(0x72e0a2);
inline const D2D1_COLOR_F Yellow = D2D1::ColorF(0xf0c44c);
inline const D2D1_COLOR_F Orange = D2D1::ColorF(0xffa45c);
inline const D2D1_COLOR_F Red = D2D1::ColorF(0xff747f);
inline const D2D1_COLOR_F Purple = D2D1::ColorF(0xb892ff);
inline const D2D1_COLOR_F Spotify = D2D1::ColorF(0x63df87);
inline constexpr float PanelRadius = 18.0f;
inline constexpr float CardRadius = 11.0f;
inline constexpr float PanelPadding = 16.0f;

inline D2D1_COLOR_F Alpha(D2D1_COLOR_F color, float alpha) {
  color.a = alpha;
  return color;
}

inline D2D1_COLOR_F Mix(D2D1_COLOR_F left, D2D1_COLOR_F right, float amount) {
  amount = std::clamp(amount, 0.0f, 1.0f);
  return D2D1::ColorF(
      left.r + (right.r - left.r) * amount,
      left.g + (right.g - left.g) * amount,
      left.b + (right.b - left.b) * amount,
      left.a + (right.a - left.a) * amount);
}
}  // namespace theme
}  // namespace hp
