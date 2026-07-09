#pragma once
#include "common.h"
#include "logger.h"

namespace hp {
class RadarManager {
 public:
  RadarManager(fs::path dataDir, Logger& log);
  ~RadarManager() = default;
  void ReloadMetadata();
  void Tick(int64_t nowMs);
  void Draw(ID2D1DeviceContext5*, IWICImagingFactory*, const D2D1_RECT_F&) {}
  void TogglePlayback();
  void Previous();
  void Next();
  void SeekFraction(float fraction);
  bool Playing() const;
  std::wstring CurrentTimeText() const;
  size_t DecodedFrameCount() const { return 0; }
  uint64_t RenderVersion() const;

  struct Tile { std::wstring url; int destX = 0; int destY = 0; };
  struct Frame { int64_t validAt = 0; std::vector<Tile> tiles; };

 private:
  void ParseMetadata();

  fs::path metadataPath_;
  Logger& log_;
  mutable std::mutex mutex_;
  int width_ = 400;
  int height_ = 260;
  int intervalMs_ = 1000;
  double playbackRate_ = 0.5;
  std::vector<Tile> baseTiles_;
  std::vector<Frame> frames_;
  int current_ = 0;
  bool playing_ = false;
  int64_t lastAdvanceAt_ = 0;
  uint64_t renderVersion_ = 0;
};
}  // namespace hp
