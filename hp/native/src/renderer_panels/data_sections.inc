void Renderer::DrawEnergySection(HDC dc, const RECT& card) {
  DrawSectionCard(dc, card);
  const RECT content = CardContentRect(card);
  HGDIOBJ previousFont = SelectObject(dc, TierFont(FontTier::Small));
  const RECT body = content;

  const auto usageText = [](double value) {
    return std::isfinite(value) ? Fixed(value, 1) + L" kWh" : L"-- kWh";
  };
  const auto costText = [](double value) {
    if (!std::isfinite(value) || value <= 0) return std::wstring{};
    return L"約¥" + std::to_wstring(static_cast<int>(std::round(value * 32.0)));
  };

  const std::array<std::tuple<std::wstring, std::wstring, std::wstring>, 2> summary{{
      {L"先月", usageText(nativeDashboard_.lastMonthUsage), costText(nativeDashboard_.lastMonthUsage)},
      {L"今月見込み", usageText(nativeDashboard_.projectedUsage), costText(nativeDashboard_.projectedUsage)},
  }};

  const int summaryHeight = SpanY(body, 300);
  const int summaryGap = std::max(4, SpanX(body, 40));
  const int summaryWidth = (static_cast<int>(body.right - body.left) - summaryGap) / 2;
  for (int i = 0; i < 2; ++i) {
    const int left = body.left + i * (summaryWidth + summaryGap);
    RECT labelRect{left, body.top, left + summaryWidth, body.top + summaryHeight * 30 / 100};
    SetTextColor(dc, kWidgetSubtle);
    SelectObject(dc, TierFont(FontTier::Small));
    DrawTextInRect(dc, std::get<0>(summary[static_cast<size_t>(i)]), labelRect,
                   DT_CENTER | DT_SINGLELINE | DT_VCENTER);
    RECT valueRect{left, labelRect.bottom, left + summaryWidth,
                   body.top + summaryHeight * 75 / 100};
    SetTextColor(dc, kWidgetText);
    SelectObject(dc, TierFont(FontTier::Medium));
    DrawTextInRect(dc, std::get<1>(summary[static_cast<size_t>(i)]), valueRect,
                   DT_CENTER | DT_SINGLELINE | DT_VCENTER);
    RECT costRect{left, valueRect.bottom, left + summaryWidth, body.top + summaryHeight};
    SetTextColor(dc, kWidgetSubtle);
    SelectObject(dc, TierFont(FontTier::Small));
    DrawTextInRect(dc, std::get<2>(summary[static_cast<size_t>(i)]), costRect,
                   DT_CENTER | DT_SINGLELINE | DT_VCENTER);
  }

  const size_t plugDeviceCount = std::min<size_t>(4, nativeDashboard_.switchBotDevices.size());
  const int plugLineHeight = std::clamp(SpanY(body, 110), 12, 22);
  const int plugRowGap = std::max(1, SpanY(body, 10));
  const int plugRowCount = plugDeviceCount > 2 ? 2 : 1;
  const int plugHeight =
      plugLineHeight * plugRowCount + plugRowGap * (plugRowCount - 1);
  RECT chart{body.left, body.top + summaryHeight + SpanY(body, 40),
             body.right, body.bottom - plugHeight - SpanY(body, 25)};
  if (chart.bottom > chart.top + 30 && !nativeDashboard_.octopusProfile.empty()) {
    double maximum = 0.1;
    for (const auto& item : nativeDashboard_.octopusProfile) {
      if (item.currentComplete && std::isfinite(item.currentTotal)) {
        maximum = std::max(maximum, item.currentTotal);
      }
      if (item.previousComplete && std::isfinite(item.previousTotal)) {
        maximum = std::max(maximum, item.previousTotal);
      }
    }
    maximum *= 1.1;

    const int chartHeight = static_cast<int>(chart.bottom - chart.top);
    const int legendHeight = std::clamp(chartHeight * 20 / 100, 12, 22);
    const int axisHeight = std::clamp(chartHeight * 15 / 100, 10, 18);
    const int yLabelWidth = std::max(44, SpanX(body, 120));
    RECT legend{chart.left, chart.top, chart.right, chart.top + legendHeight};
    SelectObject(dc, TierFont(FontTier::Small));

    const int swatchWidth = std::max(14, SpanX(body, 45));
    const int swatchHeight = std::max(3, legendHeight * 20 / 100);
    const auto drawPreviousOverlay = [&](const RECT& rect) {
      AlphaBlendSolidColor(dc, rect, kWidgetBlack, 110);
      HPEN dottedPen = CreatePen(PS_DOT, 1, kWidgetSubtle);
      HGDIOBJ previousPen = SelectObject(dc, dottedPen);
      HGDIOBJ previousBrush = SelectObject(dc, GetStockObject(NULL_BRUSH));
      Rectangle(dc, rect.left, rect.top, rect.right, rect.bottom);
      SelectObject(dc, previousBrush);
      SelectObject(dc, previousPen);
      DeleteObject(dottedPen);
    };

    double currentWeekUsage = 0.0;
    double previousWeekUsage = 0.0;
    bool currentWeekComplete = nativeDashboard_.octopusProfile.size() == 7;
    bool previousWeekComplete = currentWeekComplete;
    for (const auto& item : nativeDashboard_.octopusProfile) {
      if (item.currentComplete && std::isfinite(item.currentTotal)) {
        currentWeekUsage += item.currentTotal;
      } else {
        currentWeekComplete = false;
      }
      if (item.previousComplete && std::isfinite(item.previousTotal)) {
        previousWeekUsage += item.previousTotal;
      } else {
        previousWeekComplete = false;
      }
    }
    const auto weeklyUsageText = [](double value, bool complete) {
      return complete ? Fixed(value, 1) : std::wstring(L"--.-");
    };
    const std::wstring currentLegend =
        nativeDashboard_.currentEnergyLabel + L" " +
        weeklyUsageText(currentWeekUsage, currentWeekComplete);
    const std::wstring previousLegend =
        nativeDashboard_.previousEnergyLabel + L" " +
        weeklyUsageText(previousWeekUsage, previousWeekComplete);

    SIZE currentTextSize{};
    SIZE previousTextSize{};
    GetTextExtentPoint32W(dc, currentLegend.c_str(), static_cast<int>(currentLegend.size()),
                          &currentTextSize);
    GetTextExtentPoint32W(dc, previousLegend.c_str(), static_cast<int>(previousLegend.size()),
                          &previousTextSize);
    const int legendWidth = static_cast<int>(legend.right - legend.left);
    const int legendPadding = std::max(2, SpanX(body, 10));
    const int swatchGap = std::max(4, SpanX(body, 15));
    const int groupGap = std::max(12, SpanX(body, 45));
    const int fixedWidth = swatchWidth * 2 + swatchGap * 2 + groupGap;
    const int textWidth =
        std::max(0, legendWidth - legendPadding * 2 - fixedWidth);
    const int reservedPreviousWidth = std::min(static_cast<int>(previousTextSize.cx), textWidth / 2);
    const int currentTextWidth =
        std::min(static_cast<int>(currentTextSize.cx), textWidth - reservedPreviousWidth);
    const int previousTextWidth =
        std::min(static_cast<int>(previousTextSize.cx), textWidth - currentTextWidth);
    const int currentGroupWidth = swatchWidth + swatchGap + currentTextWidth;
    const int previousGroupWidth = swatchWidth + swatchGap + previousTextWidth;
    const int comparisonWidth = previousGroupWidth + groupGap + currentGroupWidth;
    const int comparisonLeft =
        legend.left + std::max(legendPadding, (legendWidth - comparisonWidth) / 2);
    const int swatchTop = legend.top + (legendHeight - swatchHeight) / 2;
    RECT previousSwatch{comparisonLeft, swatchTop, comparisonLeft + swatchWidth,
                        swatchTop + swatchHeight};
    RECT previousLegendRect{previousSwatch.right + swatchGap, legend.top,
                            previousSwatch.right + swatchGap + previousTextWidth, legend.bottom};
    RECT currentSwatch{previousLegendRect.right + groupGap, swatchTop,
                       previousLegendRect.right + groupGap + swatchWidth,
                       swatchTop + swatchHeight};
    RECT currentLegendRect{currentSwatch.right + swatchGap, legend.top,
                           currentSwatch.right + swatchGap + currentTextWidth, legend.bottom};
    drawPreviousOverlay(previousSwatch);
    DrawWidgetCard(dc, currentSwatch, kWidgetCyan, 2, 220);

    SetTextColor(dc, kWidgetMuted);
    DrawTextInRect(dc, previousLegend, previousLegendRect,
                   DT_LEFT | DT_SINGLELINE | DT_VCENTER | DT_END_ELLIPSIS);
    DrawTextInRect(dc, currentLegend, currentLegendRect,
                   DT_LEFT | DT_SINGLELINE | DT_VCENTER | DT_END_ELLIPSIS);

    RECT plot{chart.left + yLabelWidth, legend.bottom + SpanY(body, 15),
              chart.right - SpanX(body, 10), chart.bottom - axisHeight};
    if (plot.right > plot.left + 20 && plot.bottom > plot.top + 10) {
      for (int line = 0; line <= 4; ++line) {
        const int y = plot.bottom - static_cast<int>((plot.bottom - plot.top) * line / 4.0);
        RECT grid{plot.left, y, plot.right, y + 1};
        AlphaBlendSolidColor(dc, grid, RGB(255, 255, 255), line == 0 ? 70 : 35);
      }

      SetTextColor(dc, kWidgetSubtle);
      const int axisPrecision = maximum >= 1.0 ? 1 : 2;
      const int labelRight = plot.left - SpanX(body, 6);
      RECT maxLabel{chart.left, plot.top - SpanY(body, 20),
                    labelRight, plot.top + SpanY(body, 50)};
      DrawTextInRect(dc, Fixed(maximum, axisPrecision), maxLabel,
                     DT_RIGHT | DT_SINGLELINE | DT_VCENTER);
      const int middleY = plot.top + (plot.bottom - plot.top) / 2;
      RECT middleLabel{chart.left, middleY - SpanY(body, 35),
                       labelRight, middleY + SpanY(body, 35)};
      DrawTextInRect(dc, Fixed(maximum / 2.0, axisPrecision), middleLabel,
                     DT_RIGHT | DT_SINGLELINE | DT_VCENTER);
      RECT zeroLabel{chart.left, plot.bottom - SpanY(body, 35),
                     labelRight, plot.bottom + SpanY(body, 35)};
      DrawTextInRect(dc, L"0", zeroLabel, DT_RIGHT | DT_SINGLELINE | DT_VCENTER);

      const int count = static_cast<int>(nativeDashboard_.octopusProfile.size());
      const auto yFor = [&](double value) {
        const double ratio = std::clamp(value / maximum, 0.0, 1.0);
        return static_cast<int>(plot.bottom - (plot.bottom - plot.top) * ratio);
      };
      const int groupWidth = count > 0
          ? static_cast<int>((plot.right - plot.left) / static_cast<double>(count)) : 0;
      const int barGap = std::max(2, SpanX(body, 6));
      const int barWidth = std::max(3, groupWidth - barGap * 2);

      SelectObject(dc, TierFont(FontTier::Small));
      for (int index = 0; index < count; ++index) {
        const auto& point = nativeDashboard_.octopusProfile[static_cast<size_t>(index)];
        const int groupLeft = plot.left + index * groupWidth;
        const int currentLeft = groupLeft + barGap;

        if (point.currentComplete && std::isfinite(point.currentTotal)) {
          RECT bar{currentLeft, yFor(point.currentTotal), currentLeft + barWidth, plot.bottom};
          if (bar.bottom > bar.top) DrawWidgetCard(dc, bar, kWidgetCyan, 3, 220);
        }
        if (point.previousComplete && std::isfinite(point.previousTotal)) {
          RECT bar{currentLeft, yFor(point.previousTotal), currentLeft + barWidth, plot.bottom};
          if (bar.bottom > bar.top) drawPreviousOverlay(bar);
        }

        SetTextColor(dc, kWidgetSubtle);
        RECT dayLabel{groupLeft, plot.bottom, groupLeft + groupWidth, chart.bottom};
        DrawTextInRect(dc, point.day, dayLabel, DT_CENTER | DT_SINGLELINE | DT_VCENTER);
      }
    }
  } else if (chart.bottom > chart.top + 30) {
    SelectObject(dc, TierFont(FontTier::Small));
    SetTextColor(dc, kWidgetSubtle);
    DrawTextInRect(dc, L"使用量プロファイルを取得中", chart,
                   DT_CENTER | DT_SINGLELINE | DT_VCENTER);
  }

  SelectObject(dc, TierFont(FontTier::Small));
  SetTextColor(dc, kWidgetSubtle);
  RECT plugRect{body.left, body.bottom - plugHeight, body.right, body.bottom};
  if (plugDeviceCount == 0) {
    DrawTextInRect(dc, L"Plug Mini情報なし", plugRect,
                   DT_CENTER | DT_SINGLELINE | DT_END_ELLIPSIS | DT_VCENTER);
  } else {
    const int plugColumnGap = std::max(8, SpanX(body, 24));
    const int plugRectWidth = static_cast<int>(plugRect.right - plugRect.left);
    for (size_t i = 0; i < plugDeviceCount; ++i) {
      const int plugRow = static_cast<int>(i / 2);
      const int plugColumn = static_cast<int>(i % 2);
      const int rowStartIndex = plugRow * 2;
      const int devicesInRow =
          std::min(2, static_cast<int>(plugDeviceCount) - rowStartIndex);
      const int plugRowWidth =
          devicesInRow == 2 ? plugRectWidth * 80 / 100 : plugRectWidth;
      const int plugRowLeft = plugRect.left + (plugRectWidth - plugRowWidth) / 2;
      const int plugColumnWidth =
          (plugRowWidth - plugColumnGap * (devicesInRow - 1)) / devicesInRow;
      const int left = plugRowLeft + plugColumn * (plugColumnWidth + plugColumnGap);
      const int top = plugRect.top + plugRow * (plugLineHeight + plugRowGap);
      RECT deviceRect{left, top, left + plugColumnWidth, top + plugLineHeight};
      const std::wstring deviceText = nativeDashboard_.switchBotDevices[i].name + L" " +
                                      nativeDashboard_.switchBotDevices[i].state;
      DrawTextInRect(dc, deviceText, deviceRect,
                     DT_CENTER | DT_SINGLELINE | DT_END_ELLIPSIS | DT_VCENTER);
    }
  }
  SelectObject(dc, previousFont);
}

}  // namespace hp
