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
  {
    std::lock_guard lock(radarFrameMutex_);
    hasFrame = radarFrameBitmap_ != nullptr;
    if (hasFrame) StretchRadarInto(dc, bounds, radarFrameBitmap_);
  }
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
  }
  SelectClipRgn(dc, nullptr);
  DrawCardOutline(dc, bounds, radius);
}
