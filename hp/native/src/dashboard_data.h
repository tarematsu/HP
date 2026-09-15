#pragma once
#include "common.h"
#include <limits>

namespace hp {

struct WeatherHourData {
  int hour = 0;
  std::wstring icon;
  double temperature = std::numeric_limits<double>::quiet_NaN();
  double rainMm = std::numeric_limits<double>::quiet_NaN();
};

struct OctopusProfileData {
  std::wstring day;
  double currentTotal = std::numeric_limits<double>::quiet_NaN();
  double previousTotal = std::numeric_limits<double>::quiet_NaN();
};

struct SwitchBotDeviceData {
  std::wstring name;
  std::wstring state;

  bool operator==(const SwitchBotDeviceData&) const = default;
};

struct DashboardSectionRevisions {
  uint64_t weather = 0;
  uint64_t octopus = 0;
};

struct DashboardSnapshot {
  bool loaded = false;

  bool weatherOutage = false;
  std::vector<WeatherHourData> weatherHours;

  double lastMonthUsage = std::numeric_limits<double>::quiet_NaN();
  double projectedUsage = std::numeric_limits<double>::quiet_NaN();
  std::wstring currentEnergyLabel = L"今週";
  std::wstring previousEnergyLabel = L"先週";
  std::vector<OctopusProfileData> octopusProfile;
  std::vector<SwitchBotDeviceData> switchBotDevices;

  // Source-version-backed revisions let unchanged native sections reuse their
  // already-materialized data without stringifying or hashing whole JSON objects.
  DashboardSectionRevisions revisions;
};

bool ParseDashboardSnapshot(const std::string& text, DashboardSnapshot& output,
                            const DashboardSnapshot* previous = nullptr);
bool ParseSwitchBotDevices(const std::string& text,
                           std::vector<SwitchBotDeviceData>& output);

}  // namespace hp
