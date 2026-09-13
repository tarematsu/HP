// Rain-radar card rendering for the lower main-row radar region.
void Renderer::DrawRadarSection(HDC dc, const RECT& card) {
  const RECT& bounds = card;
  const int radius = CardRadius(bounds);
  HRGN rounded = CreateRoundRectRgn(
      bounds.left, bounds.top, bounds.right + 1, bounds.bottom + 1,
      radius, radius);
  ExtSelectClipRgn(dc, rounded, RGN_AND);
  DeleteObject(rounded);
  bool hasFrame = false;
  std::wstring timeText;
  {
    std::lock_guard lock(radarFrameMutex_);
    hasFrame = radarFrameBitmap_ != nullptr;
    timeText = radarTimeText_;
    if (hasFrame) StretchRadarInto(dc, bounds, radarFrameBitmap_);
  }
  const bool noRain = hasFrame && timeText == L"しばらく雨は降りません";
  if (!hasFrame) {
    HBRUSH surface = CreateSolidBrush(kWidgetSurface);
    FillRect(dc, &bounds, surface);
    DeleteObject(surface);
    HGDIOBJ previousFont = SelectObject(dc, TierFont(FontTier::Small));
    SetTextColor(dc, kWidgetMuted);
    DrawTextInRect(
        dc, L"レーダー画像を準備中", bounds,
        DT_CENTER | DT_SINGLELINE | DT_VCENTER);
    SelectObject(dc, previousFont);
  } else if (noRain) {
    FillRoundRectTranslucent(dc, bounds, RGB(0, 0, 0), radius, 165);
    const RECT messageBounds = NormalizeInsetRect(
        bounds, SpanX(bounds, 45), SpanY(bounds, 120),
        SpanX(bounds, 45), SpanY(bounds, 90));
    HGDIOBJ previousFont = SelectObject(dc, TierFont(FontTier::Large));
    SetTextColor(dc, kWidgetText);
    DrawTextInRect(
        dc, L"しばらく雨は降りません", messageBounds,
        DT_CENTER | DT_SINGLELINE | DT_VCENTER);
    SelectObject(dc, previousFont);
  }
  if (!hasFrame || !timeText.empty()) {
    HGDIOBJ previousFont = SelectObject(dc, TierFont(FontTier::Small));
    const std::wstring chipText = noRain
        ? L"雨雲レーダー"
        : L"雨雲レーダー " + (timeText.empty() ? L"--:--" : timeText);
    RECT measure{};
    DrawTextW(
        dc, chipText.c_str(), -1, &measure,
        DT_CALCRECT | DT_SINGLELINE | DT_NOPREFIX);
    const int chipPadX = std::max(8, SpanX(bounds, 8));
    const int chipPadY = std::max(4, SpanY(bounds, 8));
    const int chipMarginX = std::max(10, SpanY(bounds, 25));
    const int chipMarginY = std::max(1, SpanY(bounds, 2));
    const RECT chip{
        bounds.left + chipMarginX,
        bounds.top + chipMarginY,
        bounds.left + chipMarginX +
            (measure.right - measure.left) + chipPadX * 2,
        bounds.top + chipMarginY +
            (measure.bottom - measure.top) + chipPadY * 2};
    FillRoundRectTranslucent(
        dc, chip, RGB(0, 0, 0), chip.bottom - chip.top, 150);
    SetTextColor(dc, kWidgetText);
    DrawTextInRect(
        dc, chipText, chip, DT_CENTER | DT_SINGLELINE | DT_VCENTER);
    SelectObject(dc, previousFont);
  }
  SelectClipRgn(dc, nullptr);
  DrawCardOutline(dc, bounds, radius);
}
