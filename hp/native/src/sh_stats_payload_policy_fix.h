#pragma once

namespace hp {

// Stationhead has returned the streak chart through slightly different JSON
// shapes over time. The native parser deliberately accepts one compact shape,
// so normalize compatible variants in the page before posting them. Do not arm
// the ten-minute success throttle until at least one valid point exists; the
// previous implementation throttled `{}` and other malformed HTTP 200 bodies,
// leaving a stale zero visible while hiding the acquisition failure.
inline std::wstring StationheadApiPlayStatsScriptPayloadValidated(int channelId) {
  std::wstring script = StationheadApiPlayStatsScript(channelId);

  static constexpr std::wstring_view kUncheckedSuccess = LR"JS(  }).then(data => {
    if (data) {
      window.__homepanelStationheadPlayStatsSuccessAt = Date.now();
      window.__homepanelStationheadPlayStatsAuthorization = headers.authorization;
      post({ type: 'stationhead-play-stats', data, source: 'authenticated-api' });
    }
  }).catch(error => {
)JS";
  static constexpr std::wstring_view kValidatedSuccess = LR"JS(  }).then(data => {
    if (!data) return;
    const rawChart = Array.isArray(data?.chart_data) ? data.chart_data :
      (Array.isArray(data?.data?.chart_data) ? data.data.chart_data :
        (Array.isArray(data?.chartData) ? data.chartData :
          (Array.isArray(data?.data?.chartData) ? data.data.chartData : null)));
    const chartData = (rawChart || []).map(point => {
      const rawTimestamp = point?.ts ?? point?.timestamp ?? point?.date;
      const numericTimestamp = Number(rawTimestamp);
      let timestamp = Number.isFinite(numericTimestamp)
        ? numericTimestamp
        : Date.parse(String(rawTimestamp || ''));
      if (timestamp > 0 && timestamp < 10_000_000_000) timestamp *= 1000;
      const value = Number(point?.val ?? point?.value ?? point?.count);
      return Number.isFinite(timestamp) && timestamp > 0 &&
          Number.isFinite(value) && value >= 0
        ? { ts: timestamp, val: value }
        : null;
    }).filter(Boolean);
    if (!chartData.length) {
      resetSuccessThrottle();
      const keys = data && typeof data === 'object'
        ? Object.keys(data).slice(0, 12).join(',')
        : typeof data;
      post({
        type: 'stationhead-play-stats-error',
        error: 'invalid-payload:' + (keys || 'no-keys'),
      });
      return;
    }
    window.__homepanelStationheadPlayStatsSuccessAt = Date.now();
    window.__homepanelStationheadPlayStatsAuthorization = headers.authorization;
    post({
      type: 'stationhead-play-stats',
      data: { chart_data: chartData },
      source: 'authenticated-api-normalized',
    });
  }).catch(error => {
)JS";

  const bool payloadValidationReplaced = ReplaceStationheadRuntimeFragment(
      script, kUncheckedSuccess, kValidatedSuccess);
  (void)payloadValidationReplaced;
  return script;
}

}  // namespace hp

#undef StationheadApiPlayStatsScript
#define StationheadApiPlayStatsScript \
  StationheadApiPlayStatsScriptPayloadValidated
