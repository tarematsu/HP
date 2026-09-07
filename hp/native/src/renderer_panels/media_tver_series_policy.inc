// TVer series policy orchestration. DOM selection and API resolution are kept
// as independent fixed modules; this layer composes them once and defines the
// fallback order between those responsibilities.
namespace {
constexpr wchar_t kNativeMediaTverSeriesWatchdogRouterScript[] = LR"JS(
(() => {
  const domWatchdog = window.__homePanelTverSeriesDomWatchdog;
  const apiWatchdog = window.__homePanelTverSeriesApiWatchdog;
  if (typeof domWatchdog !== 'function' || typeof apiWatchdog !== 'function') {
    return null;
  }

  const domResult = domWatchdog(false);
  if (domResult !== '__homePanelTverUseSeriesApi') return domResult;

  const apiResult = apiWatchdog();
  if (apiResult !== '__homePanelTverUseDomFallback') return apiResult;

  // The API resolver is in its failure backoff window. Only then use the
  // rendered action fallback retained from #744.
  return domWatchdog(true);
})()
)JS";

const wchar_t* NativeMediaTverSeriesWatchdogPolicyScript() noexcept {
  static const std::wstring script = [] {
    std::wstring value;
    value.reserve(
        std::size(kNativeMediaTverSeriesDomPolicyModuleScript) +
        std::size(kNativeMediaTverSeriesApiPolicyModuleScript) +
        std::size(kNativeMediaTverSeriesWatchdogRouterScript) + 5U);
    value += kNativeMediaTverSeriesDomPolicyModuleScript;
    value += L";\n";
    value += kNativeMediaTverSeriesApiPolicyModuleScript;
    value += L";\n";
    value += kNativeMediaTverSeriesWatchdogRouterScript;
    return value;
  }();
  return script.c_str();
}
}  // namespace
