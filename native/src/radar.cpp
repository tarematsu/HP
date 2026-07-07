#include "radar.h"

namespace hp {
RadarManager::RadarManager(fs::path dataDir, Logger& log)
    : metadataPath_(std::move(dataDir) / L"radar.json"), log_(log) {}

void RadarManager::ReloadMetadata() {
  std::lock_guard lock(mutex_);
  baseTiles_.clear();
  frames_.clear();
  current_ = 0;
  playing_ = false;
  lastAdvanceAt_ = 0;
  ++renderVersion_;
}

void RadarManager::Tick(int64_t) {}

void RadarManager::TogglePlayback() {}

void RadarManager::Previous() {}

void RadarManager::Next() {}

void RadarManager::SeekFraction(float) {}

bool RadarManager::Playing() const { return false; }

std::wstring RadarManager::CurrentTimeText() const { return L"--:--"; }

uint64_t RadarManager::RenderVersion() const {
  std::lock_guard lock(mutex_);
  return renderVersion_;
}
}  // namespace hp
