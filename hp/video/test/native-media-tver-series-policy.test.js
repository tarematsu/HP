import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const domPolicy = readFileSync(
  new URL('../../native/src/renderer_panels/media_tver_series_dom_policy.inc', import.meta.url),
  'utf8',
);
const apiPolicy = readFileSync(
  new URL('../../native/src/renderer_panels/media_tver_series_api_policy.inc', import.meta.url),
  'utf8',
);
const orchestration = readFileSync(
  new URL('../../native/src/renderer_panels/media_tver_series_policy.inc', import.meta.url),
  'utf8',
);

test('TVer series orchestration composes DOM and API responsibilities once', () => {
  assert.match(orchestration, /kNativeMediaTverSeriesWatchdogRouterScript/);
  assert.match(orchestration, /NativeMediaTverSeriesWatchdogPolicyScript\(\)/);
  assert.match(orchestration, /kNativeMediaTverSeriesDomPolicyModuleScript/);
  assert.match(orchestration, /kNativeMediaTverSeriesApiPolicyModuleScript/);
  assert.match(orchestration, /static const std::wstring script/);
  assert.match(orchestration, /domWatchdog\(false\)/);
  assert.match(orchestration, /apiWatchdog\(\)/);
  assert.match(orchestration, /domWatchdog\(true\)/);
});

test('TVer series DOM policy is scoped to rendered-page selection only', () => {
  assert.match(domPolicy, /__homePanelTverSeriesDomWatchdog/);
  assert.match(domPolicy, /location\.pathname\.startsWith\('\/series\/'\)/);
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

test('TVer series DOM policy requests API resolution before trusted action fallback', () => {
  const apiSentinel = domPolicy.indexOf("return '__homePanelTverUseSeriesApi'");
  const fallbackGuard = domPolicy.indexOf('if (!allowActionFallback)');
  const actionPoint = domPolicy.indexOf('const actionPoint = point(action)');
  assert.ok(fallbackGuard >= 0);
  assert.ok(apiSentinel > fallbackGuard);
  assert.ok(actionPoint > apiSentinel);
  assert.match(domPolicy, /あなたにおすすめ\|おすすめ\|関連番組\|関連動画\|ランキング/);
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

test('TVer series API policy resolves published episodes independently of DOM markup', () => {
  assert.match(apiPolicy, /__homePanelTverSeriesApiWatchdog/);
  assert.match(apiPolicy, /https:\/\/service-api\.tver\.jp\/api\/v1\/callSeriesSeasons\//);
  assert.match(
    apiPolicy,
    /https:\/\/platform-api\.tver\.jp\/v2\/api\/platform_users\/browser\/create/,
  );
  assert.match(apiPolicy, /body: 'device_type=pc'/);
  assert.match(apiPolicy, /'x-tver-platform-type': 'web'/);
  assert.match(apiPolicy, /https:\/\/platform-api\.tver\.jp\/service\/api\/v1\/callSeasonEpisodes\//);
  assert.match(apiPolicy, /item\.type !== 'episode'/);
  assert.match(apiPolicy, /JSON\.stringify\(\{ hrefs, index: 0 \}\)/);
  assert.match(apiPolicy, /location\.replace\(hrefs\[0\]\)/);
  assert.doesNotMatch(apiPolicy, /querySelector/);
});

test('TVer series API policy is single-flight and exposes a DOM fallback during backoff', () => {
  assert.match(apiPolicy, /__homePanelTverSeriesApiResolver/);
  assert.match(apiPolicy, /if \(state\.inFlight\) return null/);
  assert.match(apiPolicy, /now - state\.failedAt < 15000/);
  assert.match(apiPolicy, /__homePanelTverUseDomFallback/);
  assert.match(apiPolicy, /state\.failedAt = Date\.now\(\)/);
});
