if(NOT DEFINED INPUT_RENDERER OR NOT EXISTS "${INPUT_RENDERER}")
  message(FATAL_ERROR "INPUT_RENDERER is missing")
endif()
if(NOT DEFINED OUTPUT_RENDERER OR OUTPUT_RENDERER STREQUAL "")
  message(FATAL_ERROR "OUTPUT_RENDERER is missing")
endif()

file(READ "${INPUT_RENDERER}" RENDERER_SOURCE)

function(replace_renderer_block label old_text new_text)
  string(FIND "${RENDERER_SOURCE}" "${old_text}" match_at)
  if(match_at EQUAL -1)
    message(FATAL_ERROR "Renderer patch block was not found: ${label}")
  endif()
  string(REPLACE "${old_text}" "${new_text}" patched "${RENDERER_SOURCE}")
  set(RENDERER_SOURCE "${patched}" PARENT_SCOPE)
endfunction()

replace_renderer_block("complete series maximum" [=[  for (const auto& item : nativeDashboard_.octopusProfile) {
    if (std::isfinite(item.currentAverage)) maximum = std::max(maximum, item.currentAverage);
    if (std::isfinite(item.previousAverage)) maximum = std::max(maximum, item.previousAverage);
  }]=] [=[  for (const auto& item : nativeDashboard_.octopusProfile) {
    if (item.currentDays == 7 && std::isfinite(item.currentAverage)) {
      maximum = std::max(maximum, item.currentAverage);
    }
    if (item.previousDays == 7 && std::isfinite(item.previousAverage)) {
      maximum = std::max(maximum, item.previousAverage);
    }
  }]=])

replace_renderer_block("data shortage legends" [=[  std::wstring currentLegend = nativeDashboard_.currentEnergyLabel;
  if (!nativeDashboard_.currentEnergyDateRange.empty()) {
    currentLegend += L" " + nativeDashboard_.currentEnergyDateRange;
  }
  std::wstring previousLegend = nativeDashboard_.previousEnergyLabel;
  if (!nativeDashboard_.previousEnergyDateRange.empty()) {
    previousLegend += L" " + nativeDashboard_.previousEnergyDateRange;
  }]=] [=[  const bool currentComplete = std::all_of(
      nativeDashboard_.octopusProfile.begin(), nativeDashboard_.octopusProfile.end(),
      [](const OctopusProfileData& point) { return point.currentDays == 7; });
  const bool previousComplete = std::all_of(
      nativeDashboard_.octopusProfile.begin(), nativeDashboard_.octopusProfile.end(),
      [](const OctopusProfileData& point) { return point.previousDays == 7; });
  std::wstring currentLegend = nativeDashboard_.currentEnergyLabel;
  if (!nativeDashboard_.currentEnergyDateRange.empty()) {
    currentLegend += L" " + nativeDashboard_.currentEnergyDateRange;
  }
  if (!currentComplete) currentLegend += L"（データ不足）";
  std::wstring previousLegend = nativeDashboard_.previousEnergyLabel;
  if (!nativeDashboard_.previousEnergyDateRange.empty()) {
    previousLegend += L" " + nativeDashboard_.previousEnergyDateRange;
  }
  if (!previousComplete) previousLegend += L"（データ不足）";]=])

replace_renderer_block("fixed 48-slot axis" [=[    const int count = static_cast<int>(nativeDashboard_.octopusProfile.size());
    const auto xFor = [&](int index) {
      return count <= 1 ? static_cast<int>(plot.left)
          : static_cast<int>(plot.left + (plot.right - plot.left) * index /
              static_cast<double>(count - 1));
    };]=] [=[    const int count = static_cast<int>(nativeDashboard_.octopusProfile.size());
    constexpr int profileSlots = 48;
    const auto xFor = [&](int slot) {
      return static_cast<int>(plot.left + (plot.right - plot.left) * slot /
          static_cast<double>(profileSlots));
    };]=])

replace_renderer_block("complete series drawing" [=[        const auto& point = nativeDashboard_.octopusProfile[index];
        const double value = current ? point.currentAverage : point.previousAverage;
        if (!std::isfinite(value)) {]=] [=[        const auto& point = nativeDashboard_.octopusProfile[index];
        const bool complete = current ? point.currentDays == 7 : point.previousDays == 7;
        const double value = complete
            ? (current ? point.currentAverage : point.previousAverage)
            : std::numeric_limits<double>::quiet_NaN();
        if (!std::isfinite(value)) {]=])

replace_renderer_block("24-hour boundary tick" [=[    const std::array<std::pair<int, const wchar_t*>, 5> ticks{{
        {0, L"0:00"}, {12, L"6:00"}, {24, L"12:00"}, {36, L"18:00"}, {47, L"24:00"},
    }};]=] [=[    const std::array<std::pair<int, const wchar_t*>, 5> ticks{{
        {0, L"0:00"}, {12, L"6:00"}, {24, L"12:00"}, {36, L"18:00"}, {48, L"24:00"},
    }};]=])

get_filename_component(output_directory "${OUTPUT_RENDERER}" DIRECTORY)
file(MAKE_DIRECTORY "${output_directory}")
file(WRITE "${OUTPUT_RENDERER}" "${RENDERER_SOURCE}")
