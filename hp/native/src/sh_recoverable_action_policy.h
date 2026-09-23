#pragma once

namespace hp {

// One policy owns all Stationhead music-service recovery/continuation labels.
// Both the page-side detector and the native trusted-click locator inject this
// exact JavaScript pattern, so they cannot drift apart as Stationhead changes
// the order or wording of its reconnect flow.
inline constexpr std::wstring_view kStationheadRecoverableActionPatternToken =
    L"{{RECOVERABLE_ACTION_PATTERN}}";

inline constexpr std::wstring_view kStationheadRecoverableActionPattern = LR"JS(/^(?:(?:re)?connect(?:\s+(?:to|with|your))?\s+(?:spotify(?:\s+account)?|music)|continue(?:\s+with\s+spotify)?|let(?:'|’)?s\s+go|(?:listen|continue\s+listening)\s+(?:here|on\s+this\s+device)(?:\s+instead)?|switch\s+(?:here|to\s+this\s+device))$/i)JS";

inline void InjectStationheadRecoverableActionPattern(std::wstring& script) {
  for (size_t at = script.find(kStationheadRecoverableActionPatternToken);
       at != std::wstring::npos;
       at = script.find(kStationheadRecoverableActionPatternToken,
                        at + kStationheadRecoverableActionPattern.size())) {
    script.replace(at,
                   kStationheadRecoverableActionPatternToken.size(),
                   kStationheadRecoverableActionPattern);
  }
}

}  // namespace hp
