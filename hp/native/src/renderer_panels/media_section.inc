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

  const auto drawProgress = [&](int64_t progressMs, int64_t durationMs, bool playing) {
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
    // The one-second timer invalidates only the progress strip. Avoid the normal
    // NativePlaybackRender construction here because it copies title, artist and
    // artwork strings even though none of them are visible inside this clip.
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

  constexpr int64_t kRecentPlaySampleMaximumAgeMs = 10 * 60'000;
  constexpr int64_t kDailyPlayStatsStaleAfterMs = 15 * 60'000;
  const bool recentHistoryFresh = !nativeStationheadPlayHistory_.empty() &&
      nativeStationheadPlayHistory_.back().timestamp > 0 &&
      nowMs >= nativeStationheadPlayHistory_.back().timestamp &&
      nowMs - nativeStationheadPlayHistory_.back().timestamp <=
          kRecentPlaySampleMaximumAgeMs;
  const int recentIncrease = recentHistoryFresh
      ? RecentStationheadPlayIncrease(nativeStationheadPlayHistory_)
      : -1;
  const std::wstring recentText = playValueText(recentIncrease);
  const bool statsAvailable = nativeStationhead_.dailyPlayStatsUpdatedAt > 0 &&
      !nativeStationhead_.dailyPlayCounts.empty();
  const bool statsStale = statsAvailable &&
      (nowMs < nativeStationhead_.dailyPlayStatsUpdatedAt ||
       nowMs - nativeStationhead_.dailyPlayStatsUpdatedAt >
           kDailyPlayStatsStaleAfterMs);

  struct DailyPlaySummaryTextCache {
    const Renderer* owner = nullptr;
    const void* pointsIdentity = nullptr;
    int64_t statsUpdatedAt = -1;
    int64_t dayOrdinal = std::numeric_limits<int64_t>::min();
    bool stale = false;
    std::wstring text;
  };
  static DailyPlaySummaryTextCache dailyCache;
  // Stationhead daily counts are keyed by UTC date. UTC midnight is 09:00 JST,
  // so the displayed "today" changes at the requested local boundary without
  // translating the source dates into another calendar.
  const int64_t dayOrdinal = StationheadUtcDayOrdinal(nowMs);
  const void* pointsIdentity = nativeStationhead_.dailyPlayCounts.identity();
  if (dailyCache.owner != this || dailyCache.pointsIdentity != pointsIdentity ||
      dailyCache.statsUpdatedAt != nativeStationhead_.dailyPlayStatsUpdatedAt ||
      dailyCache.dayOrdinal != dayOrdinal || dailyCache.stale != statsStale) {
    StationheadPlayPeriodSummary playSummary;
    if (statsAvailable) {
      // Keep the last known-good values during a temporary API/auth outage. The
      // header marks them as waiting for refresh instead of silently reverting
      // to zero or presenting old data as current.
      playSummary = SummarizeStationheadDailyPlays(
          nativeStationhead_.dailyPlayCounts, nowMs);
    }
    dailyCache.owner = this;
    dailyCache.pointsIdentity = pointsIdentity;
    dailyCache.statsUpdatedAt = nativeStationhead_.dailyPlayStatsUpdatedAt;
    dailyCache.dayOrdinal = dayOrdinal;
    dailyCache.stale = statsStale;
    dailyCache.text =
        L"　本日 " + playValueText(playSummary.today) +
        L"　昨日 " + playValueText(playSummary.yesterday) +
        L"　今週 " + playValueText(playSummary.thisWeek) +
        L"　先週 " + playValueText(playSummary.lastWeek) +
        (statsStale ? L"　更新待ち" : L"");
  }
  const std::wstring dailyPlaySummary =
      L"直近1時間 " + recentText + dailyCache.text;
  SetTextColor(dc, statsStale ? kWidgetWarning : kWidgetSubtle);
  RECT dailyPlayHeader{content.left, content.top, content.right,
                       content.top + CardHeaderHeight(content)};
  DrawTextInRect(dc, dailyPlaySummary, dailyPlayHeader,
                 DT_RIGHT | DT_SINGLELINE | DT_END_ELLIPSIS | DT_VCENTER);

  const int artworkRadius = std::max(6, rowHeight * 14 / 100);
  DrawWidgetCard(dc, rects.artwork, kWidgetSurfaceAlt, artworkRadius);
  if (!allStationheadsOnFallback && sharedPlayback.hasTrack) {
    const int saved = SaveDC(dc);
    HRGN artworkClip = CreateRoundRectRgn(rects.artwork.left, rects.artwork.top,
                                          rects.artwork.right + 1, rects.artwork.bottom + 1,
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
  const std::wstring artist = sharedPlayback.hasTrack ? sharedPlayback.track.artist : L"";
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
                    withProgress ? rowRect.top + rowHeight * 62 / 100 : rowRect.bottom - pad};
    DrawTextInRect(dc, artistOrDetail, artistRect,
                   DT_LEFT | DT_SINGLELINE | DT_END_ELLIPSIS | DT_VCENTER);
  }

  if (withProgress) {
    drawProgress(sharedPlayback.progressMs, sharedPlayback.track.durationMs,
                 sharedPlayback.playing);
  }

  DrawWidgetCard(dc, rects.button, kWidgetSuccessSurface, CardRadius(rects.button));
  SetTextColor(dc, kWidgetGreen);
  SelectObject(dc, TierFont(FontTier::Small));
  DrawTextInRect(dc, nativeStationhead_.primaryAudioSelected ? L"音声A" : L"音声B",
                 rects.button, DT_CENTER | DT_SINGLELINE | DT_VCENTER);

  DrawWidgetCard(dc, rects.muteButton, kWidgetDangerSurface,
                 CardRadius(rects.muteButton));
  SetTextColor(dc, kWidgetDanger);
  DrawTextInRect(dc, L"MUTE", rects.muteButton,
                 DT_CENTER | DT_SINGLELINE | DT_VCENTER);

  SelectObject(dc, previousFont);
}

// Stationhead play history is recorded by App; no history bar is rendered here.
