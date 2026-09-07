import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const wrapper = readFileSync(
  new URL('../../native/src/renderer_panels/media_section.inc', import.meta.url),
  'utf8',
);
const policy = readFileSync(
  new URL('../../native/src/renderer_panels/media_tver_start_policy.inc', import.meta.url),
  'utf8',
);

test('TVer series page opens the newest episode without viewport-dependent clicking', () => {
  assert.match(wrapper, /#include \"media_tver_start_policy\.inc\"/);
  assert.match(
    wrapper,
    /script == kNativeMediaTverWatchdogScript[\s\S]*return kNativeMediaTverWatchdogPolicyScript/,
  );
  assert.match(policy, /location\.pathname\.startsWith\('\/series\/'\)/);
  assert.match(policy, /a\[href\*=\"\/episodes\/\"\]/);
  assert.match(policy, /最新話\|最新エピソード\|最新\|NEW/);
  assert.match(policy, /__homePanelTverEpisodeQueue:/);
  assert.match(policy, /const latestIndex = Math\.max\(0, links\.indexOf\(latest\)\)/);
  assert.match(policy, /JSON\.stringify\(\{ hrefs, index: latestIndex \}\)/);
  assert.match(policy, /const latestHref = latest\.__homePanelNormalizedEpisodeHref/);
  assert.match(policy, /location\.replace\(latestHref\)/);
  assert.doesNotMatch(policy, /latest\.scrollIntoView/);
  assert.doesNotMatch(policy, /return point\(latest\)/);
});

test('TVer survey close is available before and after episode navigation', () => {
  const surveyIndex = policy.indexOf('const surveyClose = controls.find');
  const seriesIndex = policy.indexOf("location.pathname.startsWith('/series/')");
  const episodeIndex = policy.indexOf("location.pathname.startsWith('/episodes/')");
  assert.ok(surveyIndex >= 0);
  assert.ok(seriesIndex > surveyIndex);
  assert.ok(episodeIndex > surveyIndex);
  assert.match(policy, /閉じる\|とじる\|close\|dismiss/);
  assert.match(policy, /アンケート\|ご回答\|回答する\|誕生年\|誕生月\|性別/);
  assert.match(policy, /if \(surveyClose\) return point\(surveyClose\)/);
});

test('stopped TVer episodes prioritize a trusted play click before fullscreen', () => {
  const pausedIndex = policy.indexOf('video.paused && !video.ended');
  const fullscreenIndex = policy.indexOf('state && state.fullscreenDirty === false');
  assert.ok(pausedIndex >= 0);
  assert.ok(fullscreenIndex > pausedIndex);
  assert.match(policy, /const playButton = controls\.find/);
  assert.match(policy, /再生/);
  assert.match(policy, /play(?: video)?/);
  assert.match(policy, /if \(playButton\) return point\(playButton\)/);
  assert.match(policy, /if \(video\) return point\(video\)/);
});

test('episode-page ad and fullscreen guards remain intact in the startup policy', () => {
  assert.match(policy, /state && state\.restartRequested/);
  assert.match(policy, /state && state\.adActive/);
  assert.match(policy, /window\.__homePanelTverAdActive/);
  assert.match(policy, /state && state\.fullscreenDirty === false/);
  assert.match(policy, /fullscreenButton \? point\(fullscreenButton\) : null/);
});
