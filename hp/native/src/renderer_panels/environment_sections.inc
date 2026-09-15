void Renderer::DrawAirSection(HDC dc, const RECT& card) {
  DrawSectionCard(dc, card);
  const RECT body = CardContentRect(card);
  const RECT statsRect = RearrangedAirStatsRectFromCard(card);
  const RECT plot = RearrangedAirGraphRectFromCard(card);
  RECT clip{};
  GetClipBox(dc, &clip);
  RECT overlap{};
  const bool drawStats = IntersectRect(&overlap, &clip, &statsRect) != FALSE;
  const bool drawGraph = IntersectRect(&overlap, &clip, &plot) != FALSE;

  if (drawStats) {
    HGDIOBJ previousFont = SelectObject(dc, TierFont(FontTier::Small));
    const bool connected = nativeSensors_.co2Connected;
    struct AirStat {
      std::wstring label;
      std::wstring value;
      COLORREF color;
    };
    const std::array<AirStat, 3> stats{{
        {L"CO2", connected ? std::to_wstring(nativeSensors_.co2) + L" ppm" : L"--- ppm",
         connected ? kWidgetGreen : kWidgetMuted},
        {L"温度", connected ? Fixed(nativeSensors_.temperatureCorrected, 1) + L"℃" : L"--.-℃",
         connected ? kWidgetText : kWidgetMuted},
        {L"湿度", connected ? Fixed(nativeSensors_.humidityCorrected, 0) + L"%" : L"--%",
         kWidgetMuted},
    }};
    const int statsHeight = SpanY(body, 270);
    const int statsGap = std::max(4, SpanX(body, 30));
    const int cardWidth = (static_cast<int>(body.right - body.left) - statsGap * 2) / 3;
    for (int i = 0; i < 3; ++i) {
      const int left = body.left + i * (cardWidth + statsGap);
      RECT labelRect{left, body.top, left + cardWidth, body.top + statsHeight * 40 / 100};
      SetTextColor(dc, kWidgetSubtle);
      SelectObject(dc, TierFont(FontTier::Small));
      DrawTextInRect(dc, stats[i].label, labelRect, DT_CENTER | DT_SINGLELINE | DT_VCENTER);
      RECT valueRect{left, labelRect.bottom, left + cardWidth, body.top + statsHeight};
      SetTextColor(dc, stats[i].color);
      SelectObject(dc, TierFont(FontTier::Medium));
      DrawTextInRect(dc, stats[i].value, valueRect, DT_CENTER | DT_SINGLELINE | DT_VCENTER);
    }
    SelectObject(dc, previousFont);
  }

  if (!drawGraph) return;

  HGDIOBJ previousFont = SelectObject(dc, TierFont(FontTier::Small));
  constexpr int64_t kWindowMs = 24LL * 60 * 60 * 1000;
  const auto& samples = nativeAirHistory_;
  const int64_t cutoff = UnixMillis() - kWindowMs;
  const auto first = std::lower_bound(
      samples.begin(), samples.end(), cutoff,
      [](const AirHistorySample& sample, int64_t timestamp) {
        return sample.timestamp < timestamp;
      });

  if (plot.right > plot.left + 4 && plot.bottom > plot.top + 4) {
    HPEN gridPen = CreatePen(PS_SOLID, 1, kWidgetTrack);
    HGDIOBJ previousPen = SelectObject(dc, gridPen);
    for (int i = 0; i < 4; ++i) {
      const int y = plot.top + (plot.bottom - plot.top) * i / 3;
      MoveToEx(dc, plot.left, y, nullptr);
      LineTo(dc, plot.right, y);
    }
    for (int i = 1; i <= 3; ++i) {
      const int x = plot.left + (plot.right - plot.left) * i / 4;
      MoveToEx(dc, x, plot.top, nullptr);
      LineTo(dc, x, plot.bottom);
    }
    SelectObject(dc, previousPen);
    DeleteObject(gridPen);
  }

  if (first != samples.end() && plot.bottom > plot.top + 4) {
    double co2Min = first->co2, co2Max = first->co2;
    double temperatureMin = first->temperature, temperatureMax = first->temperature;
    double humidityMin = first->humidity, humidityMax = first->humidity;
    for (auto item = std::next(first); item != samples.end(); ++item) {
      co2Min = std::min(co2Min, static_cast<double>(item->co2));
      co2Max = std::max(co2Max, static_cast<double>(item->co2));
      temperatureMin = std::min(temperatureMin, item->temperature);
      temperatureMax = std::max(temperatureMax, item->temperature);
      humidityMin = std::min(humidityMin, item->humidity);
      humidityMax = std::max(humidityMax, item->humidity);
    }
    DrawHistoryLine(dc, samples, plot, cutoff, kWindowMs,
                    co2Min - 80, co2Max + 80, kWidgetGreen, 2,
                    [](const AirHistorySample& s) { return static_cast<double>(s.co2); });
    DrawHistoryLine(dc, samples, plot, cutoff, kWindowMs,
                    temperatureMin - 0.5, temperatureMax + 0.5, kWidgetText, 1,
                    [](const AirHistorySample& s) { return s.temperature; });
    DrawHistoryLine(dc, samples, plot, cutoff, kWindowMs,
                    humidityMin - 2, humidityMax + 2, kWidgetMuted, 1,
                    [](const AirHistorySample& s) { return s.humidity; }, PS_DOT);
  } else {
    SetTextColor(dc, kWidgetSubtle);
    DrawTextInRect(dc, L"履歴を取得中", plot, DT_CENTER | DT_SINGLELINE | DT_VCENTER);
  }

  SelectObject(dc, previousFont);
}

void Renderer::DrawWeatherSection(HDC dc, const RECT& card) {
  DrawSectionCard(dc, card);
  const RECT body = CardContentRect(card);
  const auto& hours = nativeDashboard_.weatherHours;
  constexpr int kColumns = 6;
  constexpr int kSlots = 12;

  HGDIOBJ previousFont = SelectObject(dc, TierFont(FontTier::Small));
  if (nativeDashboard_.weatherOutage) {
    SelectObject(dc, TierFont(FontTier::Large));
    SetTextColor(dc, kWidgetDanger);
    DrawTextInRect(dc, L"障害中", body, DT_CENTER | DT_SINGLELINE | DT_VCENTER);
    SelectObject(dc, previousFont);
    return;
  }

  const int bodyWidth = std::max(1, static_cast<int>(body.right - body.left));
  const int bodyHeight = std::max(1, static_cast<int>(body.bottom - body.top));
  const int columnGap = std::max(3, SpanX(body, 18));
  const int rowGap = std::max(4, SpanY(body, 20));
  const int columnWidth = std::max(1, (bodyWidth - columnGap * (kColumns - 1)) / kColumns);
  const int rowHeight = std::max(1, (bodyHeight - rowGap) / 2);
  const int count = std::min(kSlots, static_cast<int>(hours.size()));

  for (int i = 0; i < count; ++i) {
    const int row = i / kColumns;
    const int columnIndex = i % kColumns;
    const int left = body.left + columnIndex * (columnWidth + columnGap);
    const int top = body.top + row * (rowHeight + rowGap);
    const RECT column{
        left,
        top,
        columnIndex == kColumns - 1 ? body.right : left + columnWidth,
        row == 1 ? body.bottom : top + rowHeight,
    };
    const auto& hourData = hours[static_cast<size_t>(i)];
    const int columnHeight = std::max(1, static_cast<int>(column.bottom - column.top));
    const int hourHeight = std::max(1, columnHeight * 18 / 100);
    const int iconSlotHeight = std::max(1, columnHeight * 42 / 100);
    const int temperatureHeight = std::max(1, columnHeight * 22 / 100);

    SetTextColor(dc, kWidgetMuted);
    SelectObject(dc, TierFont(FontTier::Small));
    RECT hourRect{column.left, column.top, column.right, column.top + hourHeight};
    DrawTextInRect(dc, std::to_wstring(hourData.hour) + L"時",
                   hourRect, DT_CENTER | DT_SINGLELINE | DT_VCENTER);

    RECT iconSlot{column.left, hourRect.bottom, column.right,
                  std::min(static_cast<int>(column.bottom),
                           static_cast<int>(hourRect.bottom) + iconSlotHeight)};
    if (!hourData.icon.empty() && iconSlot.bottom > iconSlot.top) {
      int iconWidth = std::min(static_cast<int>(column.right - column.left),
                               iconSlotHeight * 90 / 48);
      iconWidth = std::max(1, iconWidth);
      const int iconHeight = std::max(1, std::min(iconSlotHeight, iconWidth * 48 / 90));
      iconWidth = std::max(1, std::min(iconWidth, iconHeight * 90 / 48));
      RECT iconRect{
          column.left + (static_cast<int>(column.right - column.left) - iconWidth) / 2,
          iconSlot.top + (static_cast<int>(iconSlot.bottom - iconSlot.top) - iconHeight) / 2,
          column.left + (static_cast<int>(column.right - column.left) + iconWidth) / 2,
          iconSlot.top + (static_cast<int>(iconSlot.bottom - iconSlot.top) + iconHeight) / 2,
      };
      DrawPremultipliedBitmap(dc,
          NativeWeatherIconBitmap(hourData.icon,
                                  IsWeatherNightHour(hourData.hour),
                                  iconWidth, iconHeight),
          iconRect);
    }

    SetTextColor(dc, kWidgetText);
    SelectObject(dc, TierFont(FontTier::Medium));
    RECT tempRect{column.left, iconSlot.bottom, column.right,
                  std::min(static_cast<int>(column.bottom),
                           static_cast<int>(iconSlot.bottom) + temperatureHeight)};
    DrawTextInRect(dc, NumberOrDash(hourData.temperature, 0) + L"℃",
                   tempRect, DT_CENTER | DT_SINGLELINE | DT_VCENTER);

    SetTextColor(dc, std::isfinite(hourData.rainMm) && hourData.rainMm > 0
                         ? kWidgetBlueMuted : kWidgetSubtle);
    SelectObject(dc, TierFont(FontTier::Small));
    RECT rainRect{column.left, tempRect.bottom, column.right, column.bottom};
    DrawTextInRect(dc, NumberOrDash(hourData.rainMm, 0) + L"mm",
                   rainRect, DT_CENTER | DT_SINGLELINE | DT_VCENTER);
  }
  SelectObject(dc, previousFont);
}
