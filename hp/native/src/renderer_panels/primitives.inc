#include "web_renderer.h"
#include "wic_image.h"

namespace hp {
namespace {
constexpr int kNativeSideId = 101;
constexpr int kNativeMainId = 102;
constexpr int kNativeMediaId = 108;

constexpr COLORREF kWidgetBackground = kNativeDashboardBackground;
constexpr COLORREF kWidgetSurface = RGB(20, 26, 36);
constexpr COLORREF kWidgetSurfaceAlt = RGB(31, 39, 52);
constexpr COLORREF kWidgetOutline = RGB(43, 54, 69);
constexpr COLORREF kWidgetText = RGB(238, 242, 248);
constexpr COLORREF kWidgetMuted = RGB(159, 171, 189);
constexpr COLORREF kWidgetSubtle = RGB(110, 122, 141);

constexpr COLORREF kWidgetBlueMuted = RGB(100, 176, 255);
constexpr COLORREF kWidgetGreen = RGB(48, 209, 88);
constexpr COLORREF kWidgetOrange = RGB(255, 159, 10);
constexpr COLORREF kWidgetCyan = RGB(50, 173, 230);
constexpr COLORREF kWidgetBlack = RGB(0, 0, 0);
constexpr COLORREF kWidgetTrack = RGB(42, 52, 66);
constexpr COLORREF kWidgetDanger = RGB(255, 69, 58);

HBRUSH CachedSolidBrush(COLORREF color) {
  static std::map<COLORREF, HBRUSH> cache;
  auto [entry, inserted] = cache.try_emplace(color, nullptr);
  if (inserted) entry->second = CreateSolidBrush(color);
  return entry->second;
}

HPEN CachedPen(int style, int width, COLORREF color) {
  static std::map<std::tuple<int, int, COLORREF>, HPEN> cache;
  const auto key = std::make_tuple(style, width, color);
  auto [entry, inserted] = cache.try_emplace(key, nullptr);
  if (inserted) entry->second = CreatePen(style, width, color);
  return entry->second;
}

struct CachedSourceMemoryDc {
  HDC value = nullptr;
  ~CachedSourceMemoryDc() {
    if (value) DeleteDC(value);
  }
};

HDC SourceMemoryDc(HDC compatibleDc) {
  thread_local CachedSourceMemoryDc cached;
  if (!cached.value) cached.value = CreateCompatibleDC(compatibleDc);
  return cached.value;
}

void PlaceNativeWindow(HWND hwnd, const RECT& rect, bool visible) {
  SetWindowPos(hwnd, HWND_TOP, rect.left, rect.top,
               std::max(1L, rect.right - rect.left),
               std::max(1L, rect.bottom - rect.top),
               SWP_NOACTIVATE | SWP_NOSENDCHANGING |
                   (visible ? SWP_SHOWWINDOW : SWP_HIDEWINDOW));
}

int SpanX(const RECT& rect, int permille) {
  return static_cast<int>((rect.right - rect.left) * permille / 1000);
}
int SpanY(const RECT& rect, int permille) {
  return static_cast<int>((rect.bottom - rect.top) * permille / 1000);
}

const wchar_t* DashboardFontFace() {
  static const wchar_t* face = [] {
    LOGFONTW probe{};
    probe.lfCharSet = DEFAULT_CHARSET;
    wcscpy_s(probe.lfFaceName, L"BIZ UDPGothic");
    bool found = false;
    HDC dc = GetDC(nullptr);
    if (dc) {
      EnumFontFamiliesExW(dc, &probe,
          [](const LOGFONTW*, const TEXTMETRICW*, DWORD, LPARAM param) -> int {
            *reinterpret_cast<bool*>(param) = true;
            return 0;
          }, reinterpret_cast<LPARAM>(&found), 0);
      ReleaseDC(nullptr, dc);
    }
    return found ? L"BIZ UDPGothic" : L"Yu Gothic UI";
  }();
  return face;
}

HFONT CreateUiFont(int height, int weight) {
  return CreateFontW(-height, 0, 0, 0, weight, FALSE, FALSE, FALSE, DEFAULT_CHARSET,
                     OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS, CLEARTYPE_QUALITY,
                     DEFAULT_PITCH | FF_DONTCARE, DashboardFontFace());
}

HFONT CachedUiFont(int height, int weight) {
  static std::map<std::pair<int, int>, HFONT> cache;
  const auto key = std::make_pair(height, weight);
  auto [entry, inserted] = cache.try_emplace(key, nullptr);
  if (inserted) entry->second = CreateUiFont(height, weight);
  return entry->second;
}

void DrawPremultipliedBitmap(HDC dc, HBITMAP bitmap, const RECT& target) {
  if (!bitmap) return;
  const int width = target.right - target.left;
  const int height = target.bottom - target.top;
  if (width <= 0 || height <= 0) return;
  HDC sourceDc = SourceMemoryDc(dc);
  if (!sourceDc) return;
  HGDIOBJ previousBitmap = SelectObject(sourceDc, bitmap);
  const BLENDFUNCTION blend{AC_SRC_OVER, 0, 255, AC_SRC_ALPHA};
  AlphaBlend(dc, target.left, target.top, width, height, sourceDc, 0, 0, width, height, blend);
  SelectObject(sourceDc, previousBitmap);
}

void DrawTextInRect(HDC dc, const wchar_t* text, RECT rect, int format) {
  DrawTextW(dc, text ? text : L"", -1, &rect, format | DT_NOPREFIX);
}

void DrawTextInRect(HDC dc, const std::wstring& text, RECT rect, int format) {
  DrawTextW(dc, text.c_str(), -1, &rect, format | DT_NOPREFIX);
}

void FillWidgetBackground(HDC dc, const RECT& bounds) {
  FillRect(dc, &bounds, CachedSolidBrush(kWidgetBackground));
}

void AlphaBlendSolidColor(HDC dc, const RECT& rect, COLORREF color, BYTE alpha);

HBITMAP SolidColorBitmap(COLORREF color) {
  static std::map<COLORREF, HBITMAP> cache;
  auto [entry, inserted] = cache.try_emplace(color, nullptr);
  if (!inserted) return entry->second;

  BITMAPINFO info{};
  info.bmiHeader.biSize = sizeof(info.bmiHeader);
  info.bmiHeader.biWidth = 1;
  info.bmiHeader.biHeight = -1;
  info.bmiHeader.biPlanes = 1;
  info.bmiHeader.biBitCount = 32;
  info.bmiHeader.biCompression = BI_RGB;
  void* pixel = nullptr;
  HBITMAP bitmap = CreateDIBSection(nullptr, &info, DIB_RGB_COLORS, &pixel, nullptr, 0);
  if (bitmap && pixel) {
    *static_cast<uint32_t*>(pixel) =
        (GetRValue(color) << 16) | (GetGValue(color) << 8) | GetBValue(color);
  }
  entry->second = bitmap;
  return bitmap;
}

void FillRoundRectTranslucent(HDC dc, const RECT& rect, COLORREF color, int radius, BYTE alpha) {
  HRGN clip = CreateRoundRectRgn(rect.left, rect.top, rect.right + 1, rect.bottom + 1, radius, radius);
  SelectClipRgn(dc, clip);
  AlphaBlendSolidColor(dc, rect, color, alpha);
  SelectClipRgn(dc, nullptr);
  DeleteObject(clip);
}

void DrawWidgetCard(HDC dc, const RECT& rect, COLORREF color = kWidgetSurface,
                    int radius = 14, BYTE alpha = 255) {
  if (rect.right <= rect.left || rect.bottom <= rect.top) return;
  if (alpha < 255) {
    FillRoundRectTranslucent(dc, rect, color, radius, alpha);
    return;
  }
  HGDIOBJ previousPen = SelectObject(dc, GetStockObject(NULL_PEN));
  HGDIOBJ previousBrush = SelectObject(dc, CachedSolidBrush(color));
  RoundRect(dc, rect.left, rect.top, rect.right, rect.bottom, radius, radius);
  SelectObject(dc, previousBrush);
  SelectObject(dc, previousPen);
}

std::wstring Fixed(double value, int digits) {
  std::wostringstream output;
  output << std::fixed << std::setprecision(digits) << value;
  return output.str();
}

std::wstring NumberOrDash(double value, int digits = 0) {
  if (!std::isfinite(value)) return L"--";
  return Fixed(value, digits);
}

template <typename ValueOf>
void DrawHistoryLine(HDC dc, const std::vector<AirHistorySample>& samples, const RECT& plot,
                     int64_t cutoff, int64_t spanMs, double minValue, double maxValue,
                     COLORREF color, int width, ValueOf&& valueOf, int style = PS_SOLID) {
  if (samples.empty() || maxValue <= minValue) return;
  HGDIOBJ previousPen = SelectObject(dc, CachedPen(style, width, color));
  bool started = false;
  for (const auto& sample : samples) {
    const double value = valueOf(sample);
    if (!std::isfinite(value) || sample.timestamp < cutoff) continue;
    const double xRatio = std::clamp(static_cast<double>(sample.timestamp - cutoff) / spanMs, 0.0, 1.0);
    const double yRatio = std::clamp((value - minValue) / (maxValue - minValue), 0.0, 1.0);
    const int x = plot.left + static_cast<int>((plot.right - plot.left) * xRatio);
    const int y = plot.bottom - static_cast<int>((plot.bottom - plot.top) * yRatio);
    if (!started) {
      MoveToEx(dc, x, y, nullptr);
      started = true;
    } else {
      LineTo(dc, x, y);
    }
  }
  SelectObject(dc, previousPen);
}

void AlphaBlendSolidColor(HDC dc, const RECT& rect, COLORREF color, BYTE alpha) {
  if (alpha == 0 || rect.right <= rect.left || rect.bottom <= rect.top) return;
  HBITMAP colorBitmap = SolidColorBitmap(color);
  if (!colorBitmap) return;
  HDC colorDc = SourceMemoryDc(dc);
  if (!colorDc) return;
  HGDIOBJ previousBitmap = SelectObject(colorDc, colorBitmap);
  const BLENDFUNCTION blend{AC_SRC_OVER, 0, alpha, 0};
  AlphaBlend(dc, rect.left, rect.top, rect.right - rect.left, rect.bottom - rect.top,
             colorDc, 0, 0, 1, 1, blend);
  SelectObject(colorDc, previousBitmap);
}

int CardRadius(const RECT& card) {
  const int width = std::max(1L, card.right - card.left);
  const int height = std::max(1L, card.bottom - card.top);
  return std::clamp(std::min(width, height) * 16 / 100, 10, 28);
}

RECT CardContentRect(const RECT& card) {
  const int width = std::max(1L, card.right - card.left);
  const int height = std::max(1L, card.bottom - card.top);
  const int pad = std::clamp(std::min(width, height) * 10 / 100, 8, 26);
  return NormalizeInsetRect(card, pad, pad, pad, pad);
}

void DrawCardOutline(HDC dc, const RECT& rect, int radius) {
  if (rect.right <= rect.left || rect.bottom <= rect.top) return;
  HGDIOBJ previousPen = SelectObject(dc, CachedPen(PS_SOLID, 1, kWidgetOutline));
  HGDIOBJ previousBrush = SelectObject(dc, GetStockObject(NULL_BRUSH));
  RoundRect(dc, rect.left, rect.top, rect.right, rect.bottom, radius, radius);
  SelectObject(dc, previousBrush);
  SelectObject(dc, previousPen);
}

void DrawSectionCard(HDC dc, const RECT& rect) {
  const int radius = CardRadius(rect);
  DrawWidgetCard(dc, rect, kWidgetSurface, radius);
  DrawCardOutline(dc, rect, radius);
}

struct SidebarSections {
  RECT clock{};
  RECT weather{};
  RECT energy{};
  RECT controls{};
};

struct MainSections {
  RECT radar{};
  RECT energy{};
  RECT news{};
};

struct CachedPanelMemoryDc {
  HDC value = nullptr;
  ~CachedPanelMemoryDc() {
    if (value) DeleteDC(value);
  }
};

HDC NativePanelMemoryDc(HDC compatibleDc) {
  thread_local CachedPanelMemoryDc cached;
  if (!cached.value) cached.value = CreateCompatibleDC(compatibleDc);
  return cached.value;
}

constexpr UINT_PTR kNativePanelTickTimer = 1;
constexpr UINT kNativePanelTickMs = 1'000;
}