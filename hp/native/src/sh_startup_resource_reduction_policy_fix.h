#pragma once
#include "sh_data_acquisition_resource_policy_fix.h"

namespace hp {

inline constexpr bool StationheadOptionalStylesheetBoundaryFixed(
    std::wstring_view uriLower) {
  const StationheadRuntimeUriParts uri = StationheadParseRuntimeUri(uriLower);
  if (!uri.valid || uri.scheme != L"https" ||
      !StationheadRuntimeHostMatches(uri.host, L"stationhead.com")) {
    return false;
  }

  constexpr std::wstring_view kPrefix = L"/assets/tooltip-";
  constexpr std::wstring_view kExtension = L".css";
  if (!uri.path.starts_with(kPrefix) || !uri.path.ends_with(kExtension)) {
    return false;
  }
  const std::wstring_view hash = uri.path.substr(
      kPrefix.size(), uri.path.size() - kPrefix.size() - kExtension.size());
  if (hash.size() < 6) return false;
  for (const wchar_t character : hash) {
    const bool allowed = (character >= L'a' && character <= L'z') ||
                         (character >= L'0' && character <= L'9') ||
                         character == L'-' || character == L'_';
    if (!allowed) return false;
  }
  return true;
}

static_assert(StationheadOptionalStylesheetBoundaryFixed(
    L"https://www.stationhead.com/assets/tooltip-u7w9wxcq.css"));
static_assert(StationheadOptionalStylesheetBoundaryFixed(
    L"https://stationhead.com/assets/tooltip-next_12.css"));
static_assert(!StationheadOptionalStylesheetBoundaryFixed(
    L"https://www.stationhead.com/assets/tooltip.css"));
static_assert(!StationheadOptionalStylesheetBoundaryFixed(
    L"https://www.stationhead.com/nested/assets/tooltip-u7w9wxcq.css"));
static_assert(!StationheadOptionalStylesheetBoundaryFixed(
    L"https://stationhead.com.evil.example/assets/tooltip-u7w9wxcq.css"));

// Keep authenticated account/statistics requests fail-open, but restore the
// audited SelectedGIF module stub now that statistics session acquisition is
// independent of that mixed UI bundle. Tooltip CSS is also unnecessary after
// the child-preserving Tooltip JavaScript stub is installed.
inline void ApplyStationheadResourceBlockingStartupReduced(
    ICoreWebView2Environment* environment,
    ICoreWebView2* webview,
    const StationheadConfig& config,
    std::atomic<bool>& armed,
    EventRegistrationToken& token) {
  (void)armed;
  if (!environment || !webview) return;

  ComPtr<ICoreWebView2> base = webview;
  ComPtr<ICoreWebView2_22> sourceAwareWebView;
  base.As(&sourceAwareWebView);
  auto sourceKinds = COREWEBVIEW2_WEB_RESOURCE_REQUEST_SOURCE_KINDS_DOCUMENT;
  if (StationheadOwnsWorkerRequestFilters(webview)) {
    sourceKinds = static_cast<COREWEBVIEW2_WEB_RESOURCE_REQUEST_SOURCE_KINDS>(
        sourceKinds |
        COREWEBVIEW2_WEB_RESOURCE_REQUEST_SOURCE_KINDS_SHARED_WORKER |
        COREWEBVIEW2_WEB_RESOURCE_REQUEST_SOURCE_KINDS_SERVICE_WORKER);
  }
  const auto addFilter = [&](COREWEBVIEW2_WEB_RESOURCE_CONTEXT context) {
    AddStationheadResourceFilter(
        webview, sourceAwareWebView.Get(), context, sourceKinds);
  };

  const bool blockImages = config.blockImages;
  const bool blockFonts = config.blockFonts;
  if (blockImages) addFilter(COREWEBVIEW2_WEB_RESOURCE_CONTEXT_IMAGE);
  if (blockFonts) addFilter(COREWEBVIEW2_WEB_RESOURCE_CONTEXT_FONT);
  addFilter(COREWEBVIEW2_WEB_RESOURCE_CONTEXT_STYLESHEET);
  addFilter(COREWEBVIEW2_WEB_RESOURCE_CONTEXT_MEDIA);
  addFilter(COREWEBVIEW2_WEB_RESOURCE_CONTEXT_SCRIPT);
  addFilter(COREWEBVIEW2_WEB_RESOURCE_CONTEXT_XML_HTTP_REQUEST);
  addFilter(COREWEBVIEW2_WEB_RESOURCE_CONTEXT_FETCH);
  addFilter(COREWEBVIEW2_WEB_RESOURCE_CONTEXT_TEXT_TRACK);
  addFilter(COREWEBVIEW2_WEB_RESOURCE_CONTEXT_EVENT_SOURCE);
  addFilter(COREWEBVIEW2_WEB_RESOURCE_CONTEXT_WEBSOCKET);
  addFilter(COREWEBVIEW2_WEB_RESOURCE_CONTEXT_MANIFEST);
  addFilter(COREWEBVIEW2_WEB_RESOURCE_CONTEXT_PING);
  addFilter(COREWEBVIEW2_WEB_RESOURCE_CONTEXT_CSP_VIOLATION_REPORT);

  ComPtr<ICoreWebView2Environment> env = environment;
  webview->add_WebResourceRequested(
      Callback<ICoreWebView2WebResourceRequestedEventHandler>(
          [env, blockImages, blockFonts](
              ICoreWebView2*,
              ICoreWebView2WebResourceRequestedEventArgs* args) -> HRESULT {
            if (!args) return S_OK;
            COREWEBVIEW2_WEB_RESOURCE_CONTEXT context =
                COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL;
            const bool hasContext =
                SUCCEEDED(args->get_ResourceContext(&context));
            bool block = false;
            bool emptyScript = false;
            bool emptyResource = false;
            std::string_view moduleStub;
            bool needsUri = true;
            if (hasContext) {
              if ((blockImages && context == COREWEBVIEW2_WEB_RESOURCE_CONTEXT_IMAGE) ||
                  (blockFonts && context == COREWEBVIEW2_WEB_RESOURCE_CONTEXT_FONT) ||
                  context == COREWEBVIEW2_WEB_RESOURCE_CONTEXT_TEXT_TRACK ||
                  context == COREWEBVIEW2_WEB_RESOURCE_CONTEXT_MANIFEST ||
                  context == COREWEBVIEW2_WEB_RESOURCE_CONTEXT_PING ||
                  context == COREWEBVIEW2_WEB_RESOURCE_CONTEXT_CSP_VIOLATION_REPORT) {
                block = true;
                emptyResource = true;
                needsUri = false;
              }
            }
            if (needsUri) {
              std::wstring lower;
              ComPtr<ICoreWebView2WebResourceRequest> request;
              if (SUCCEEDED(args->get_Request(&request)) && request) {
                LPWSTR uriRaw = nullptr;
                if (SUCCEEDED(request->get_Uri(&uriRaw)) && uriRaw) {
                  lower = StationheadLowerAscii(uriRaw);
                  CoTaskMemFree(uriRaw);
                }
              }

              const bool protectedData =
                  StationheadDataAcquisitionRequestBoundaryFixed(lower);
              if (!protectedData) {
                if (hasContext &&
                    context == COREWEBVIEW2_WEB_RESOURCE_CONTEXT_SCRIPT) {
                  moduleStub =
                      StationheadKnownOptionalModuleStubBoundaryFixed(lower);
                  if (!moduleStub.empty()) {
                    block = true;
                  } else {
                    emptyScript =
                        StationheadRequestIsBlockableBoundaryFixed(lower) ||
                        StationheadExpandedNonPlaybackScriptBoundaryFixed(lower);
                    block = emptyScript;
                  }
                } else if (hasContext &&
                           context == COREWEBVIEW2_WEB_RESOURCE_CONTEXT_STYLESHEET) {
                  block = StationheadOptionalStylesheetBoundaryFixed(lower);
                  emptyResource = block;
                } else {
                  block = StationheadRequestIsBlockableBoundaryFixed(lower);
                }
                if (!block && blockImages &&
                    StationheadRequestLooksLikeImage(lower)) {
                  block = true;
                  emptyResource = true;
                }
                if (!block && hasContext &&
                    context == COREWEBVIEW2_WEB_RESOURCE_CONTEXT_MEDIA) {
                  block = !lower.empty() &&
                          !StationheadCorePlaybackRequestBoundaryFixed(lower);
                  emptyResource = block;
                }
              }
            }
            if (block) {
              const bool replacementScript =
                  emptyScript || !moduleStub.empty();
              ComPtr<IStream> responseBody;
              if (!moduleStub.empty()) {
                responseBody.Attach(SHCreateMemStream(
                    reinterpret_cast<const BYTE*>(moduleStub.data()),
                    static_cast<UINT>(moduleStub.size())));
                if (!responseBody) return S_OK;
              }
              ComPtr<ICoreWebView2WebResourceResponse> response;
              const int status =
                  replacementScript ? 200 : (emptyResource ? 204 : 403);
              const wchar_t* reason = replacementScript
                  ? L"OK"
                  : (emptyResource ? L"No Content" : L"Blocked");
              const wchar_t* headers = replacementScript
                  ? L"Content-Type: application/javascript; charset=utf-8\r\n"
                    L"Cache-Control: public, max-age=31536000, immutable"
                  : (emptyResource
                         ? L"Content-Length: 0\r\n"
                           L"Cache-Control: public, max-age=31536000, immutable"
                         : L"");
              if (SUCCEEDED(env->CreateWebResourceResponse(
                      responseBody.Get(), status, reason, headers, &response))) {
                args->put_Response(response.Get());
              }
            }
            return S_OK;
          }).Get(),
      &token);

  BlockStationheadTelemetrySocketsBoundaryFixed(webview);
}

inline std::wstring StationheadStartupDomReductionScript() {
  static constexpr wchar_t kScript[] = LR"JS(
(() => {
  const host = String(location.hostname || '').toLowerCase();
  if ((host !== 'stationhead.com' && !host.endsWith('.stationhead.com')) ||
      window.top !== window || window.__homepanelStationheadStartupDomReduction) {
    return;
  }
  window.__homepanelStationheadStartupDomReduction = true;

  const optionalSelectors = [
    '[data-testid*="gif" i]',
    '[data-testid*="chat" i]',
    '[data-testid*="thread" i]',
    '[data-testid*="tipping" i]',
    '[data-testid*="gift" i]',
    '[data-testid*="reaction" i]',
    '[data-testid*="emoji" i]',
    '[data-testid*="leaderboard" i]',
    '[data-testid*="apple-music" i]',
    '[data-testid*="free-trial" i]',
    '[data-testid*="download-app" i]',
    '[aria-label*="gif" i]',
    '[aria-label*="open chat" i]',
    '[aria-label*="send gift" i]',
    'img[src*="giphy" i]',
    'img[src*="/gif" i]'
  ];
  const selector = optionalSelectors.join(',');
  const protectedPattern = /start\s+listening|listen\s+(?:now|live)|join\s+(?:station|room)|spotify|log\s*in|sign\s*in|login|play|pause|resume|continue|audio|volume|ログイン|再生|一時停止|続ける|接続/i;
  const optionalLabelPattern = /^(?:gif|open gif|chat|open chat|threads?|tipping|send (?:a )?gift|gifts?|reactions?|emoji|leaderboard|connect apple music|start free trial|download (?:the )?app|get the app)$/i;
  const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
  const labelOf = element => normalize([
    element?.getAttribute?.('aria-label'),
    element?.getAttribute?.('data-testid'),
    element?.getAttribute?.('title'),
    element?.innerText,
    element?.textContent,
  ].filter(Boolean).join(' '));
  const protectedSurface = element => {
    const shell = element?.closest?.(
      'form,[role="dialog"],[aria-modal="true"],[data-testid*="auth" i],[data-testid*="login" i]');
    return protectedPattern.test(labelOf(element)) ||
      (shell && protectedPattern.test(labelOf(shell)));
  };
  const remove = element => {
    if (!(element instanceof Element) || !element.isConnected ||
        protectedSurface(element)) return;
    element.remove();
  };
  const scan = root => {
    if (!root?.querySelectorAll) return;
    if (root instanceof Element && root.matches(selector)) remove(root);
    for (const element of root.querySelectorAll(selector)) remove(element);
    for (const element of root.querySelectorAll(
        'button,[role="button"],a,[aria-label],[title]')) {
      const label = labelOf(element);
      if (optionalLabelPattern.test(label) && !protectedPattern.test(label)) {
        remove(element);
      }
    }
  };

  const style = document.createElement('style');
  style.id = 'homepanel-stationhead-startup-reduction';
  style.textContent = `${selector}{display:none!important;visibility:hidden!important}`;
  (document.head || document.documentElement)?.appendChild(style);

  let active = true;
  let frame = 0;
  const schedule = root => {
    if (!active || frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (active) scan(root?.isConnected ? root : document);
    });
  };
  const observer = new MutationObserver(records => {
    let root = document;
    for (const record of records) {
      const candidate = Array.from(record.addedNodes).find(
        node => node instanceof Element);
      if (candidate) {
        root = candidate;
        break;
      }
    }
    schedule(root);
  });
  const stop = () => {
    if (!active) return;
    active = false;
    observer.disconnect();
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
  };
  observer.observe(document, { childList: true, subtree: true });
  window.addEventListener('pagehide', stop, { once: true, capture: true });
  window.setTimeout(stop, 15000);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => scan(document), { once: true });
  } else {
    scan(document);
  }
})()
)JS";
  return kScript;
}

inline std::wstring StationheadAutoplayScriptStartupReduced(
    const wchar_t* globalName,
    const wchar_t* messagePrefix) {
  std::wstring script =
      StationheadAutoplayScriptRuntimeFixed(globalName, messagePrefix);
  script.push_back(L'\n');
  script.append(StationheadStartupDomReductionScript());
  return script;
}

}  // namespace hp

#undef ApplyStationheadResourceBlocking
#define ApplyStationheadResourceBlocking ApplyStationheadResourceBlockingStartupReduced
#undef StationheadAutoplayScript
#define StationheadAutoplayScript StationheadAutoplayScriptStartupReduced
