#pragma once
#include "common.h"
#include <limits>

namespace hp {

enum class PanelDataState { Waiting, Ok, Stale, Error };

struct PanelDataStatus {
  PanelDataState state = PanelDataState::Waiting;
  std::wstring error;
  int64_t lastSuccessAt = 0;
};

struct WeatherHourData {
  int hour = 0;
  std::wstring icon;
  double temperature = std::numeric_limits<double>::quiet_NaN();
  double precipitationProbability = std::numeric_limits<double>::quiet_NaN();
  double rainMm = std::numeric_limits<double>::quiet_NaN();
};

struct NewsItemData {
  std::wstring title;
  std::wstring description;
};

struct OctopusProfileData {
  std::wstring day;
  double currentTotal = std::numeric_limits<double>::quiet_NaN();
  double previousTotal = std::numeric_limits<double>::quiet_NaN();
  bool currentComplete = false;
  bool previousComplete = false;
};

struct SwitchBotDeviceData {
  std::wstring name;
  std::wstring state;
};

struct DashboardSectionRevisions {
  uint64_t weather = 0;
  uint64_t energy = 0;
  uint64_t news = 0;
};

struct DashboardSnapshot {
  bool loaded = false;
  std::wstring cloudError;

  PanelDataStatus weatherStatus;
  std::wstring city;
  std::vector<WeatherHourData> weatherHours;

  PanelDataStatus newsStatus;
  std::vector<NewsItemData> newsItems;
  int newsItemCount = 0;

  PanelDataStatus octopusStatus;
  double lastMonthUsage = std::numeric_limits<double>::quiet_NaN();
  double projectedUsage = std::numeric_limits<double>::quiet_NaN();
  std::wstring currentEnergyLabel = L"今週";
  std::wstring previousEnergyLabel = L"先週";
  std::wstring currentEnergyDateRange;
  std::wstring previousEnergyDateRange;
  std::vector<OctopusProfileData> octopusProfile;

  PanelDataStatus switchBotStatus;
  std::wstring switchBotPresence;
  std::wstring switchBotBrightness;
  bool switchBotDoorOpen = false;
  bool switchBotMotion = false;
  std::vector<SwitchBotDeviceData> switchBotDevices;

  // Stable per-section content revisions let the renderer invalidate only the
  // panels whose source data changed, rather than repainting the whole dashboard.
  DashboardSectionRevisions revisions;
};

bool ParseDashboardSnapshot(const std::string& text, DashboardSnapshot& output,
                            std::wstring* error = nullptr);
bool LoadDashboardSnapshot(const fs::path& path, DashboardSnapshot& output, std::wstring* error = nullptr);

}  // namespace hp
