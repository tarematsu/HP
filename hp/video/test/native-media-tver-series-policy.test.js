import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const domPolicy = readFileSync(
  new URL('../../native/src/renderer_panels/media_tver_series_dom_policy.inc', import.meta.url),
  'utf8',
);
const nativeResolver = readFileSync(
  new URL('../../native/src/renderer_panels/media_tver_native_series_resolver.inc', import.meta.url),
  'utf8',
);
const orchestration = readFileSync(
  new URL('../../native/src/renderer_panels/media_tver_series_policy.inc', import.meta.url),
  'utf8',
);
const wrapper = readFileSync(
  new URL('../../native/src/renderer_panels/media_section.inc', import.meta.url),
  'utf8',
);

test('TVer series WebView policy owns DOM interaction only', () => {
  assert.match(orchestration, /kNativeMediaTverSeriesWatchdogRouterScript/);
  assert.match(orchestration, /NativeMediaTverSeriesWatchdogPolicyScript\(\)/);
  assert.match(orchestration, /kNativeMediaTverSeriesDomPolicyModuleScript/);
  assert.match(orchestration, /domWatchdog\(\)/);
  assert.doesNotMatch(orchestration, /SeriesApiPolicyModuleScript/);
  assert.doesNotMatch(orchestration, /apiWatchdog/);
});

test('TVer series DOM policy is scoped to rendered-page selection only', () => {
  assert.match(domPolicy, /__homePanelTverSeriesDomWatchdog = \(\) =>/);
  assert.match(domPolicy, /location\.pathname\.startsWith\('\/series\/'\)/);
  assert.doesNotMatch(domPolicy, /allowActionFallback/);
  assert.doesNotMatch(domPolicy, /__homePanelTverUseSeriesApi/);
  assert.doesNotMatch(domPolicy, /callSeriesSeasons/);
  assert.doesNotMatch(domPolicy, /callSeasonEpisodes/);
  assert.doesNotMatch(domPolicy, /video\.paused/);
  assert.doesNotMatch(domPolicy, /fullscreenButton/);
});

test('TVer series DOM policy opens the newest rendered episode without viewport clicking', () => {
  assert.match(domPolicy, /a\[href\*=\"\/episodes\/\"\]/);
  assert.match(domPolicy, /最新話\|最新エピソード\|最新\|NEW/);
  assert.match(domPolicy, /__homePanelTverEpisodeQueue:/);
  assert.match(domPolicy, /const latestIndex = Math\.max\(0, links\.indexOf\(latest\)\)/);
  assert.match(domPolicy, /location\.replace\(latestHref\)/);
  assert.doesNotMatch(domPolicy, /latest\.scrollIntoView/);
  assert.doesNotMatch(domPolicy, /return point\(latest\)/);
});

test('TVer series DOM policy fails closed instead of scanning page-wide episode links', () => {
  assert.match(domPolicy, /if \(!anchorHeading\) return \[\];/);
  assert.match(domPolicy, /container = container\.parentElement;[\s\S]*return \[\];/);
  assert.doesNotMatch(
    domPolicy,
    /return Array\.from\(root\.querySelectorAll\('a\[href\*=\"\/episodes\/\"\]'\)\)/,
  );
});

test('TVer series DOM policy retains the trusted action fallback', () => {
  assert.match(domPolicy, /エピソードを再生\|最新話を再生\|最新エピソードを再生\|本編を再生/);
  assert.match(
    domPolicy,
    /action\.scrollIntoView\(\{ block: 'center', inline: 'nearest' \}\)/,
  );
  assert.match(domPolicy, /const actionPoint = point\(action\)/);
  assert.match(domPolicy, /if \(actionPoint\) return actionPoint/);
  assert.match(domPolicy, /try \{ action\.click\(\); \} catch \(_\) \{\}/);
  assert.match(domPolicy, /あなたにおすすめ\|おすすめ\|関連番組\|関連動画\|ランキング/);
  assert.match(domPolicy, /__homePanelTverAcceptNextEpisode:/);
  assert.match(domPolicy, /sessionStorage\.setItem\(pendingEpisodeKey\(location\.pathname\), '1'\)/);
});

test('TVer series DOM policy dismisses a blocking survey before episode selection', () => {
  const surveyIndex = domPolicy.indexOf('const surveyClose = controls.find');
  const linksIndex = domPolicy.indexOf('const rawLinks = seriesEpisodeLinks()');
  assert.ok(surveyIndex >= 0);
  assert.ok(linksIndex > surveyIndex);
  assert.match(domPolicy, /閉じる\|とじる\|close\|dismiss/);
  assert.match(domPolicy, /アンケート\|ご回答\|回答する\|誕生年\|誕生月\|性別/);
  assert.match(domPolicy, /if \(surveyClose\) return point\(surveyClose\)/);
});

test('TVer native resolver performs the API chain outside browser fetch', () => {
  assert.match(nativeResolver, /WinHttpOpen\(/);
  assert.match(nativeResolver, /WinHttpSendRequest\(/);
  assert.match(nativeResolver, /service-api\.tver\.jp\/api\/v1\/callSeriesSeasons\//);
  assert.match(nativeResolver, /platform-api\.tver\.jp\/v2\/api\/platform_users\/browser\/create/);
  assert.match(nativeResolver, /device_type=pc/);
  assert.match(nativeResolver, /platform-api\.tver\.jp\/service\/api\/v1\/callSeasonEpisodes\//);
  assert.match(nativeResolver, /x-tver-platform-type: web/);
  assert.match(nativeResolver, /Origin: https:\/\/tver\.jp/);
  assert.match(nativeResolver, /Referer: https:\/\/tver\.jp\//);
  assert.match(nativeResolver, /Mozilla\/5\.0/);
  assert.doesNotMatch(nativeResolver, /\bfetch\s*\(/);
});

test('TVer native resolver initializes COM on its worker and retries failed discovery', () => {
  assert.match(nativeResolver, /struct NativeMediaTverComApartment/);
  assert.match(nativeResolver, /CoInitializeEx\(nullptr, COINIT_MULTITHREADED\)/);
  assert.match(nativeResolver, /if \(SUCCEEDED\(result\)\) CoUninitialize\(\)/);
  assert.match(nativeResolver, /std::thread\(/);
  assert.match(nativeResolver, /NativeMediaTverComApartment apartment/);
  assert.match(nativeResolver, /\.detach\(\)/);
  assert.match(nativeResolver, /kNativeMediaTverSeriesRetryMs = 15'000ULL/);
  assert.match(nativeResolver, /state\.inFlight = true/);
  assert.match(nativeResolver, /state\.failedAt = GetTickCount64\(\)/);
  assert.match(nativeResolver, /PostMessageW\(hostWindow, WM_TIMER, kNativeMediaTverWatchdogTimer, 0\)/);
});

test('TVer native resolver restores the existing episode queue before navigation', () => {
  assert.match(nativeResolver, /__homePanelTverSeriesPath/);
  assert.match(nativeResolver, /__homePanelTverEpisodeQueue:/);
  assert.match(nativeResolver, /JSON\.stringify\(\{hrefs,index:0\}\)/);
  assert.match(nativeResolver, /NativeMediaTverSeriesIdFromWebView\(view\.Get\(\)\)/);
  assert.match(nativeResolver, /view->Navigate\(episodeUrl\.c_str\(\)\)/);
  assert.match(nativeResolver, /MarkNativeMediaTverNavigationFailed/);
});

test('TVer accepted navigation cannot suppress series DOM recovery forever', () => {
  assert.match(wrapper, /kNativeMediaTverNavigationPendingMaxMs = 8ULL \* 1000ULL/);
  assert.match(wrapper, /observedGeneration != state\.generation/);
  assert.match(
    wrapper,
    /if \(now - observedAt < kNativeMediaTverNavigationPendingMaxMs\) return true;/,
  );
  assert.match(wrapper, /state\.navigationPending = false;/);
  assert.match(wrapper, /state\.failedAt = now;/);
  const clearIndex = wrapper.indexOf('state.navigationPending = false;');
  const fallbackIndex = wrapper.indexOf('return NativeMediaTverSeriesWatchdogPolicyScript();');
  assert.ok(clearIndex >= 0);
  assert.ok(fallbackIndex > clearIndex);
});
