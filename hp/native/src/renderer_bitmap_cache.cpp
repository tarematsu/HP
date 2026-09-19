#include "web_renderer.h"
#include "wic_image.h"

namespace hp {
namespace {
constexpr size_t kWeatherIconBitmapCacheLimit = 12;
constexpr int64_t kNativeImageDecodeRetryMs = 60'000;

template <typename Cache, typename Loader>
HBITMAP CachedBitmap(Cache& cache, uint64_t& useCounter, size_t limit,
                     const std::wstring& key, Loader&& load) {
  auto found = cache.find(key);
  if (found != cache.end()) {
    if (found->second.bitmap) {
      found->second.lastUsed = ++useCounter;
      return found->second.bitmap;
    }
    if (UnixMillis() < static_cast<int64_t>(found->second.lastUsed)) return nullptr;
    cache.erase(found);
  }
  if (cache.size() >= limit) {
    auto oldest = cache.end();
    for (auto item = cache.begin(); item != cache.end(); ++item) {
      if (!item->second.bitmap) { oldest = item; break; }
      if (oldest == cache.end() || item->second.lastUsed < oldest->second.lastUsed) oldest = item;
    }
    if (oldest != cache.end()) {
      if (oldest->second.bitmap) DeleteObject(oldest->second.bitmap);
      cache.erase(oldest);
    }
  }
  HBITMAP bitmap = load();
  const uint64_t stamp = bitmap ? ++useCounter
      : static_cast<uint64_t>(UnixMillis() + kNativeImageDecodeRetryMs);
  cache[key] = {bitmap, stamp};
  return bitmap;
}
}  // namespace

HBITMAP Renderer::NativePanelBackBuffer(HWND, HDC dc, int width, int height) {
  if (!dc || width <= 0 || height <= 0) return nullptr;

  // Native panels paint serially on the UI thread. Keep one grow-only backing
  // bitmap shared by all child HWNDs instead of retaining a bitmap per panel.
  PanelBackBuffer& buffer = nativeBackBuffers_[nullptr];
  if (buffer.bitmap && buffer.width >= width && buffer.height >= height) {
    return buffer.bitmap;
  }

  const int targetWidth = std::max(width, buffer.width);
  const int targetHeight = std::max(height, buffer.height);
  HBITMAP replacement = CreateCompatibleBitmap(dc, targetWidth, targetHeight);
  if (!replacement) return buffer.bitmap;
  if (buffer.bitmap) DeleteObject(buffer.bitmap);
  buffer.bitmap = replacement;
  buffer.width = targetWidth;
  buffer.height = targetHeight;
  return buffer.bitmap;
}

void Renderer::ReleaseNativePanelBackBuffer(HWND) {
  // Shared by all panel HWNDs; ReleaseNativePanelSurfaces owns its lifetime.
}

HBITMAP Renderer::NativeWeatherIconBitmap(
    const std::wstring& icon, bool night, int width, int height) {
  const std::wstring fileName = icon + (night ? L"_night.png" : L"_day.png");
  const std::wstring key = fileName + L"#" + std::to_wstring(width) + L"x" + std::to_wstring(height);
  return CachedBitmap(nativeWeatherIconBitmaps_, nativeWeatherIconUseCounter_,
                      kWeatherIconBitmapCacheLimit, key, [&] {
    const auto decodeIcon = [&](const std::wstring& name) {
      return DecodeImageFileToBitmap(rootDir_ / L"ui" / L"weather-icons" / name, width, height);
    };
    HBITMAP bitmap = decodeIcon(fileName);
    if (!bitmap && night) bitmap = decodeIcon(icon + L"_day.png");
    if (!bitmap) {
      const wchar_t family = icon.front();
      const std::wstring fallback = icon == L"600" ? L"200" :
          (icon == L"650" || icon == L"850") ? L"300" :
          icon == L"950" ? L"400" : family == L'2' ? L"200" :
          family == L'3' ? L"300" : family == L'4' ? L"400" : L"100";
      bitmap = decodeIcon(fallback + (night ? L"_night.png" : L"_day.png"));
      if (!bitmap && night) bitmap = decodeIcon(fallback + L"_day.png");
    }
    return bitmap;
  });
}

void Renderer::ReleaseNativePanelSurfaces() noexcept {
  for (auto& item : nativeBackBuffers_) if (item.second.bitmap) DeleteObject(item.second.bitmap);
  nativeBackBuffers_.clear();
}

void Renderer::ResetNativeBitmapCaches() noexcept {
  ReleaseNativePanelSurfaces();
  if (energyBitmapCache_.bitmap) DeleteObject(energyBitmapCache_.bitmap);
  energyBitmapCache_ = {};
  for (auto& item : nativeWeatherIconBitmaps_) {
    if (item.second.bitmap) DeleteObject(item.second.bitmap);
  }
  nativeWeatherIconBitmaps_.clear();
  nativeWeatherIconUseCounter_ = 0;
}

}  // namespace hp