// TVer series-page WebView orchestration. DOM interaction stays in the WebView;
// TVer API discovery is owned by the native resolver and runs independently.
namespace {
constexpr wchar_t kNativeMediaTverSeriesWatchdogRouterScript[] = LR"JS(
(() => {
  const domWatchdog = window.__homePanelTverSeriesDomWatchdog;
  if (typeof domWatchdog !== 'function') return null;
  return domWatchdog();
})()
)JS";

const wchar_t* NativeMediaTverSeriesWatchdogPolicyScript() noexcept {
  static const std::wstring script = [] {
    std::wstring value;
    value.reserve(
        std::size(kNativeMediaTverSeriesDomPolicyModuleScript) +
        std::size(kNativeMediaTverSeriesWatchdogRouterScript) + 3U);
    value += kNativeMediaTverSeriesDomPolicyModuleScript;
    value += L";\n";
    value += kNativeMediaTverSeriesWatchdogRouterScript;
    return value;
  }();
  return script.c_str();
}
}  // namespace
