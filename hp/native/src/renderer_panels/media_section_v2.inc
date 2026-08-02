void Renderer::DrawMusicSection(HDC dc, const RECT& card) {
  const RECT content = CardContentRect(card);
  const RECT body = CardBodyRect(content);
  const MusicRowRects rects = MusicRowFromBody(body);
  const RECT& rowRect = rects.row;
  const int rowHeight = std::max(1, static_cast<int>(rowRect.bottom - rowRect.top));
  const int pad = std::max(6, rowHeight * 10 / 100);
  const int textLeft = rects.artwork.right + pad;
  const int textRight = rects.button.left - pad;
  const bool primaryOnFallback =
      IsStationheadFallbackUrl(nativeStationhead_.url, nativeStationhead_.fallbackUrl);
  const bool secondaryConfigured = !nativeStationhead_.secondaryUrl.empty();
  const bool allStationheadsOnFallback = primaryOnFallback &&
      (!secondaryConfigured ||
       IsStationheadFallbackUrl(nativeStationhead_.secondaryUrl,
                                nativeStationhead_.fallbackUrl));
  const bool selectedAudioPlaying = nativeStationhead_.primaryAudioSelected
      ? nativeStationhead_.audioPlaying
      : nativeStationhead_.secondaryPlaying;
  const int64_t nowMs = UnixMillis();

  RECT clip{};
  GetClipBox(dc, &clip);
  const RECT progressRect = MusicProgressRectFromBody(body);
  const bool progressClipOnly =
      clip.left >= progressRect.left && clip.top >= progressRect.top &&
      clip.right <= progressRect.right && clip.bottom <= progressRect.bottom;

  const auto drawProgress = [&](int64_t progressMs, int64_t durationMs,
                                bool playing) {
    RECT barRect{textLeft, rowRect.top + rowHeight * 66 / 100,
                 textRight, rowRect.top + rowHeight * 72 / 100};
    DrawWidgetPill(dc, barRect, kWidgetTrack);
    const double ratio = std::clamp(
        static_cast<double>(progressMs) / static_cast<double>(durationMs),
        0.0, 1.0);
    RECT fillRect = barRect;
    fillRect.right = barRect.left +
        static_cast<int>((barRect.right - barRect.left) * ratio);
    if (fillRect.right > fillRect.left) {
      DrawWidgetPill(dc, fillRect, playing ? kWidgetGreen : kWidgetMuted);
    }

    SetTextColor(dc, kWidgetSubtle);
    RECT timeRect{textLeft, barRect.bottom + rowHeight * 3 / 100,
                  textRight, rowRect.bottom - rowHeight * 3 / 100};
    DrawTextInRect(dc, TrackTimeText(progressMs), timeRect,
                   DT_LEFT | DT_SINGLELINE | DT_VCENTER);
    DrawTextInRect(dc, TrackTimeText(durationMs), timeRect,
                   DT_RIGHT | DT_SINGLELINE | DT_VCENTER);
  };

  if (progressClipOnly && !allStationheadsOnFallback) {
    int64_t progressMs = 0;
    int64_t progressDurationMs = 0;
    bool progressPlaying = false;
    bool progressAvailable = false;
    {
      std::lock_guard lock(nativePlaybackMutex_);
      const NativePlaybackProjection& projection = nativePlaybackUpdate_.projection;
      const bool currentValid = projection.available && !projection.queue.empty() &&
          projection.currentIndex >= 0 &&
          projection.currentIndex < static_cast<int>(projection.queue.size());
      const bool queueEnded = projection.playing && projection.queueEndAt > 0 &&
          nowMs >= projection.queueEndAt;
      if (currentValid && !queueEnded) {
        int64_t elapsed = projection.progressMs;
        if (projection.playing) {
          if (projection.anchorAt > 0) {
            elapsed = std::max<int64_t>(0, nowMs - projection.anchorAt);
          } else if (projection.sampledAt > 0) {
            elapsed = projection.progressMs +
                std::max<int64_t>(0, nowMs - projection.sampledAt);
          }
        }

        size_t index = static_cast<size_t>(projection.currentIndex);
        int64_t remaining = std::max<int64_t>(0, elapsed);
        constexpr int64_t kProgressTransitionHoldMs = 500;
        while (index < projection.queue.size()) {
          const int64_t duration = projection.queue[index].durationMs;
          if (duration <= 0 ||
              duration > std::numeric_limits<int64_t>::max() -
                  kProgressTransitionHoldMs ||
              remaining < duration + kProgressTransitionHoldMs) {
            break;
          }
          remaining -= duration;
          ++index;
        }
        if (index < projection.queue.size()) {
          const auto& track = projection.queue[index];
          const bool hasIdentity = !track.title.empty() || !track.artist.empty() ||
              !track.artwork.empty();
          if (hasIdentity && track.durationMs > 0) {
            progressMs = std::min(remaining, track.durationMs);
            progressDurationMs = track.durationMs;
            progressPlaying = projection.playing;
            progressAvailable = true;
          }
        }
      }
    }
    if (progressAvailable) {
      FillRect(dc, &progressRect, CachedSolidBrush(kWidgetSurface));
      HGDIOBJ previousFont = SelectObject(dc, TierFont(FontTier::Small));
      drawProgress(progressMs, progressDurationMs, progressPlaying);
      SelectObject(dc, previousFont);
      return;
    }
  }

  const NativePlaybackRender sharedPlayback = allStationheadsOnFallback
      ? NativePlaybackRender{}
      : ResolveNativePlayback(0, nowMs);
  const bool withProgress = !allStationheadsOnFallback &&
      sharedPlayback.hasTrack && sharedPlayback.track.durationMs > 0;

  DrawSectionCard(dc, card);
  HGDIOBJ previousFont = SelectObject(dc, TierFont(FontTier::Small));
  const auto playValueText = [](int64_t value) {
    return value >= 0 ? std::to_wstring(value) : std::wstring(L"--");
  };

  // Play counts are sourced directly from WebView2's native response event.
  // No generated JavaScript, WebMessage generation ids, auth ids, or reducer
  // state participates in this display path.
  constexpr int64_t kDailyPlayStatsStaleAfterMs = 15 * 60'000;
  const StationheadNativeStatsSnapshot nativeStats =
      GlobalStationheadNativeStatsStore().Snapshot();
  const bool statsAvailable = nativeStats.updatedAt > 0 &&
      !nativeStats.daily.empty();
  const bool statsStale = statsAvailable &&
      (nowMs < nativeStats.updatedAt ||
       nowMs - nativeStats.updatedAt > kDailyPlayStatsStaleAfterMs);
  const StationheadPlayPeriodSummary summary = statsAvailable
      ? SummarizeStationheadDailyPlays(nativeStats.daily, nowMs)
      : StationheadPlayPeriodSummary{};

  static constexpr std::array<const wchar_t*, 5> kPlayMetricLabels{
      L"直近1時間", L"本日", L"昨日", L"今週", L"先週"};
  const std::array<std::wstring, 5> playMetricValues{
      playValueText(nativeStats.recentHour),
      playValueText(summary.today),
      playValueText(summary.yesterday),
      playValueText(summary.thisWeek),
      playValueText(summary.lastWeek),
  };
  RECT metricsRect{content.left, content.top, content.right,
                   content.top + CardHeaderHeight(content)};
  const COLORREF metricTextColor = statsStale
      ? kWidgetWarning
      : (statsAvailable || nativeStats.recentHour >= 0
             ? kWidgetText
             : kWidgetSubtle);
  std::wstring metricsLine;
  for (size_t index = 0; index < kPlayMetricLabels.size(); ++index) {
    if (!metricsLine.empty()) {
      metricsLine += L"   ";
    }
    metricsLine += kPlayMetricLabels[index];
    metricsLine += L" ";
    metricsLine += playMetricValues[index];
  }
  SelectObject(dc, TierFont(FontTier::Medium));
  SetTextColor(dc, metricTextColor);
  DrawTextInRect(dc, metricsLine, metricsRect,
                 DT_RIGHT | DT_SINGLELINE | DT_END_ELLIPSIS | DT_VCENTER);

  const int artworkRadius = std::max(6, rowHeight * 14 / 100);
  DrawWidgetCard(dc, rects.artwork, kWidgetSurfaceAlt, artworkRadius);
  if (!allStationheadsOnFallback && sharedPlayback.hasTrack) {
    const int saved = SaveDC(dc);
    HRGN artworkClip = CreateRoundRectRgn(rects.artwork.left, rects.artwork.top,
                                          rects.artwork.right + 1,
                                          rects.artwork.bottom + 1,
                                          artworkRadius, artworkRadius);
    ExtSelectClipRgn(dc, artworkClip, RGN_AND);
    DeleteObject(artworkClip);
    DrawPremultipliedBitmap(dc,
                            NativeArtworkBitmap(sharedPlayback.track.artwork,
                                                rects.artwork.right - rects.artwork.left,
                                                rects.artwork.bottom - rects.artwork.top),
                            rects.artwork);
    RestoreDC(dc, saved);
  }

  const std::wstring title = allStationheadsOnFallback
      ? L"fallback中"
      : (sharedPlayback.hasTrack ? sharedPlayback.track.title : L"");
  const std::wstring artist = sharedPlayback.hasTrack
      ? sharedPlayback.track.artist
      : L"";
  const bool stationheadNeedsAttention = nativeStationhead_.loginRequired ||
      nativeStationhead_.processFailed || nativeStationhead_.spotifyAuthorization;
  const std::wstring detail = nativeStationhead_.loginRequired ? L"ログイン待ち"
      : nativeStationhead_.processFailed ? L"WebView再起動待ち"
      : nativeStationhead_.spotifyAuthorization ? L"Spotify認証中"
      : selectedAudioPlaying ? L"再生中"
      : nativeStationhead_.created ? L"接続中"
      : L"起動待ち";
  const std::wstring rowDetail = !stationheadNeedsAttention &&
      sharedPlayback.available && !sharedPlayback.hasTrack
      ? L"次の曲を待機中"
      : detail;
  const std::wstring artistOrDetail = stationheadNeedsAttention || artist.empty()
      ? rowDetail
      : artist;

  SetTextColor(dc, kWidgetText);
  SelectObject(dc, TierFont(FontTier::Medium));
  RECT titleRect{textLeft, rowRect.top + rowHeight * 6 / 100, textRight,
                 rowRect.top + rowHeight * 42 / 100};
  DrawTextInRect(dc, title.empty() ? L"--" : title, titleRect,
                 DT_LEFT | DT_SINGLELINE | DT_END_ELLIPSIS | DT_VCENTER);

  if (!allStationheadsOnFallback || stationheadNeedsAttention) {
    SetTextColor(dc, kWidgetMuted);
    SelectObject(dc, TierFont(FontTier::Small));
    RECT artistRect{textLeft, titleRect.bottom, textRight,
                    withProgress ? rowRect.top + rowHeight * 62 / 100
                                 : rowRect.bottom - pad};
    DrawTextInRect(dc, artistOrDetail, artistRect,
                   DT_LEFT | DT_SINGLELINE | DT_END_ELLIPSIS | DT_VCENTER);
  }

  if (withProgress) {
    drawProgress(sharedPlayback.progressMs, sharedPlayback.track.durationMs,
                 sharedPlayback.playing);
  }

  DrawWidgetCard(dc, rects.button, kWidgetSuccessSurface,
                 CardRadius(rects.button));
  SetTextColor(dc, kWidgetGreen);
  SelectObject(dc, TierFont(FontTier::Small));
  DrawTextInRect(dc,
                 nativeStationhead_.primaryAudioSelected ? L"音声A" : L"音声B",
                 rects.button, DT_CENTER | DT_SINGLELINE | DT_VCENTER);

  DrawWidgetCard(dc, rects.muteButton, kWidgetDangerSurface,
                 CardRadius(rects.muteButton));
  SetTextColor(dc, kWidgetDanger);
  DrawTextInRect(dc, L"MUTE", rects.muteButton,
                 DT_CENTER | DT_SINGLELINE | DT_VCENTER);

  SelectObject(dc, previousFont);
}

// Native WebView2 response capture owns play-count history and summaries.
