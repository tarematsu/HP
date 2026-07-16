from pathlib import Path


panels = Path("native/src/renderer_panels/part2.inc")
text = panels.read_text(encoding="utf-8")
broken = "\\1\n\nvoid Renderer::RebuildNativeAirGraph"
tier_font = '''HFONT Renderer::TierFont(FontTier tier) const {
  const int clientHeight = std::max(1L, bounds_.bottom - bounds_.top);
  switch (tier) {
    case FontTier::Small:
      return CachedUiFont(std::clamp(clientHeight * 14 / 1000, 12, 24), FW_NORMAL);
    case FontTier::Medium:
      return CachedUiFont(std::clamp(clientHeight * 21 / 1000, 16, 36), FW_SEMIBOLD);
    case FontTier::Large:
    default:
      return CachedUiFont(std::clamp(clientHeight * 56 / 1000, 36, 112), FW_SEMIBOLD);
  }
}

void Renderer::RebuildNativeAirGraph'''
if text.count(broken) != 1:
    raise SystemExit("broken TierFont marker not found exactly once")
panels.write_text(text.replace(broken, tier_font), encoding="utf-8", newline="")

radar = Path("native/src/renderer_radar_ui.cpp")
text = radar.read_text(encoding="utf-8")
text = text.replace(
    '''std::optional<fs::path> RadarTilePath(const fs::path& dataDir,
                                              const std::wstring& url) {''',
    '''std::optional<fs::path> RadarTilePath(const fs::path& dataDir,
                                             const std::wstring& url) {''')

old = '''HBITMAP Renderer::CachedRadarBitmap(const std::wstring& key, const fs::path& path,
                                    int width, int height) {
  if (width <= 0 || height <= 0) return nullptr;
  const std::wstring cacheKey = key + L"#" + Utf8ToWide(FileStamp(path)) + L"#" +
      std::to_wstring(width) + L"x" + std::to_wstring(height);
  auto found = radarBitmaps_.find(cacheKey);
  if (found != radarBitmaps_.end()) {
    found->second.lastUsed = ++radarBitmapUseCounter_;
    return found->second.bitmap;
  }
  HBITMAP bitmap = DecodeImageFileToBitmap(path, width, height);
  if (!bitmap) return nullptr;
  if (radarBitmaps_.size() >= kRadarBitmapCacheLimit) {
    auto oldest = radarBitmaps_.begin();
    for (auto item = radarBitmaps_.begin(); item != radarBitmaps_.end(); ++item) {
      if (item->second.lastUsed < oldest->second.lastUsed) oldest = item;
    }
    if (oldest->second.bitmap) DeleteObject(oldest->second.bitmap);
    radarBitmaps_.erase(oldest);
  }
  radarBitmaps_[cacheKey] = ArtworkBitmapCacheEntry{bitmap, ++radarBitmapUseCounter_};
  return bitmap;
}'''
new = '''HBITMAP Renderer::CachedRadarBitmap(const std::wstring& key, const fs::path& path,
                                    int width, int height) {
  if (width <= 0 || height <= 0) return nullptr;
  const std::wstring keyPrefix = key + L"#";
  const std::wstring cacheKey = keyPrefix + Utf8ToWide(FileStamp(path)) + L"#" +
      std::to_wstring(width) + L"x" + std::to_wstring(height);
  auto found = radarBitmaps_.find(cacheKey);
  if (found != radarBitmaps_.end()) {
    found->second.lastUsed = ++radarBitmapUseCounter_;
    return found->second.bitmap;
  }

  for (auto item = radarBitmaps_.begin(); item != radarBitmaps_.end();) {
    if (item->first.rfind(keyPrefix, 0) != 0) {
      ++item;
      continue;
    }
    if (item->second.bitmap) DeleteObject(item->second.bitmap);
    item = radarBitmaps_.erase(item);
  }

  HBITMAP bitmap = DecodeImageFileToBitmap(path, width, height);
  if (!bitmap) return nullptr;
  if (radarBitmaps_.size() >= kRadarBitmapCacheLimit) {
    auto oldest = radarBitmaps_.end();
    for (auto item = radarBitmaps_.begin(); item != radarBitmaps_.end(); ++item) {
      const bool persistent = item->first.rfind(L"radar-satellite#", 0) == 0 ||
          item->first.rfind(L"radar-map#", 0) == 0;
      if (persistent) continue;
      if (oldest == radarBitmaps_.end() ||
          item->second.lastUsed < oldest->second.lastUsed) {
        oldest = item;
      }
    }
    if (oldest != radarBitmaps_.end()) {
      if (oldest->second.bitmap) DeleteObject(oldest->second.bitmap);
      radarBitmaps_.erase(oldest);
    }
  }
  radarBitmaps_[cacheKey] = ArtworkBitmapCacheEntry{bitmap, ++radarBitmapUseCounter_};
  return bitmap;
}'''
if text.count(old) != 1:
    raise SystemExit("radar cache function not found exactly once")
radar.write_text(text.replace(old, new), encoding="utf-8", newline="")
