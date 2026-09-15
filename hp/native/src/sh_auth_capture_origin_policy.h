#pragma once

namespace hp {

inline bool ReplaceStationheadAuthCaptureFragment(
    std::wstring& script,
    std::wstring_view from,
    std::wstring_view to) {
  const size_t at = script.find(from);
  if (at == std::wstring::npos) return false;
  script.replace(at, from.size(), to);
  return true;
}

// Harden the authentication-capture script only. Startup/runtime lifecycle is
// owned elsewhere; this policy restricts capture to top-level trusted HTTPS
// Stationhead URLs and normalizes fetch URL handling.
inline std::wstring StationheadAuthCaptureScriptOriginFixed() {
  std::wstring script = StationheadAuthCaptureScript();

  static constexpr std::wstring_view kDocumentGate = LR"JS(  const host = String(location.hostname || '').toLowerCase();
  if (host !== 'stationhead.com' && !host.endsWith('.stationhead.com')) return;
)JS";
  static constexpr std::wstring_view kDocumentGateFixed = LR"JS(  const host = String(location.hostname || '').toLowerCase();
  if ((host !== 'stationhead.com' && !host.endsWith('.stationhead.com')) ||
      window.top !== window) return;
)JS";
  static constexpr std::wstring_view kRelevantUrl = LR"JS(  const relevant = url => /(^|\.)stationhead\.com/i.test(String(url || ''));
)JS";
  static constexpr std::wstring_view kRelevantUrlFixed = LR"JS(  const NativeURL = window.URL;
  const relevant = value => {
    try {
      const parsed = new NativeURL(String(value || ''), location.href);
      const targetHost = String(parsed.hostname || '').toLowerCase();
      return parsed.protocol === 'https:' &&
        (targetHost === 'stationhead.com' || targetHost.endsWith('.stationhead.com'));
    } catch (_) {
      return false;
    }
  };
)JS";
  static constexpr std::wstring_view kFetchUrl = LR"JS(        const url = typeof input === 'string' ? input : (input && input.url) || '';
)JS";
  static constexpr std::wstring_view kFetchUrlFixed = LR"JS(        const url = typeof input === 'string' ? input :
          (NativeURL && input instanceof NativeURL ? input.href :
            (input && input.url) || '');
)JS";

  const bool documentGateReplaced = ReplaceStationheadAuthCaptureFragment(
      script, kDocumentGate, kDocumentGateFixed);
  const bool relevantUrlReplaced = ReplaceStationheadAuthCaptureFragment(
      script, kRelevantUrl, kRelevantUrlFixed);
  const bool fetchUrlReplaced = ReplaceStationheadAuthCaptureFragment(
      script, kFetchUrl, kFetchUrlFixed);
  (void)documentGateReplaced;
  (void)relevantUrlReplaced;
  (void)fetchUrlReplaced;
  return script;
}

}  // namespace hp

#undef StationheadAuthCaptureScript
#define StationheadAuthCaptureScript StationheadAuthCaptureScriptOriginFixed
