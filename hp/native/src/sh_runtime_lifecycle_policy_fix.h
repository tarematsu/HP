#pragma once

namespace hp {

// Small source-rewrite helper retained for the authentication capture policies.
// Startup/playback lifetime is no longer patched by generated-source wrappers.
inline bool ReplaceStationheadRuntimeFragment(
    std::wstring& script,
    std::wstring_view from,
    std::wstring_view to) {
  const size_t at = script.find(from);
  if (at == std::wstring::npos) return false;
  script.replace(at, from.size(), to);
  return true;
}

// Authentication capture runs before page JavaScript and observes fetch/XHR
// headers. Restrict it to the top-level Stationhead document and parse request
// URLs instead of matching arbitrary path/query text containing stationhead.com.
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

  const bool authDocumentGateReplaced = ReplaceStationheadRuntimeFragment(
      script, kDocumentGate, kDocumentGateFixed);
  const bool authRelevantUrlReplaced = ReplaceStationheadRuntimeFragment(
      script, kRelevantUrl, kRelevantUrlFixed);
  const bool authFetchUrlReplaced = ReplaceStationheadRuntimeFragment(
      script, kFetchUrl, kFetchUrlFixed);
  (void)authDocumentGateReplaced;
  (void)authRelevantUrlReplaced;
  (void)authFetchUrlReplaced;
  return script;
}

}  // namespace hp

#undef StationheadAuthCaptureScript
#define StationheadAuthCaptureScript StationheadAuthCaptureScriptOriginFixed
