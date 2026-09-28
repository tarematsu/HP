import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source = readFileSync(new URL('../../native/src/renderer_panels/media_x_following_like.inc', import.meta.url), 'utf8')
  .replace(/^LR"JS\(/, '').replace(/\)JS"\s*$/, '');
const mediaSection = readFileSync(
  new URL('../../native/src/renderer_panels/media_section.inc', import.meta.url), 'utf8');

async function run({ selected = true, switchWorks = true, missingTab = false, failLike = false, leaveFollowing = false, bodyMentionsRepost = false, delayedTimers = false, emptyUntil = 0 } = {}) {
  let now = 0;
  const clickTimes = [];
  const trustedMessages = [];
  const scrollSteps = [];
  let clicks = 0;
  let domLikeClicks = 0;
  const clickedIds = [];
  let scrolls = 0;
  let tabClicks = 0;
  let selectedTab = selected;
  const markLiked = new Map();
  const tab = {
    innerText: 'フォロー中',
    getAttribute: () => String(selectedTab),
    click: () => { tabClicks++; if (switchWorks) selectedTab = true; },
  };
  const article = (id, label = 'normal', initiallyLiked = false) => {
    let liked = initiallyLiked;
    markLiked.set(String(id), () => {
      if (!failLike) liked = true;
      if (leaveFollowing) selectedTab = false;
    });
    return {
      isConnected: true,
      innerText: label,
      getBoundingClientRect: () => ({ top: 10, bottom: 100 }),
      querySelector(selector) {
        if (selector === '[data-testid="socialContext"]') return label === 'repost' ? { innerText: 'user reposted' } : null;
        if (selector.includes('placement')) return null;
        if (selector === 'time') return { closest: () => ({ getAttribute: () => `/user/status/${id}` }) };
        if (selector === '[data-testid="unlike"]') return liked ? {} : null;
        if (selector === '[data-testid="like"]') return liked ? null : {
          disabled: false,
          getAttribute: () => null,
          getBoundingClientRect: () => ({ left: 40, top: 20, width: 24, height: 24 }),
          click: () => { domLikeClicks++; },
        };
        return null;
      },
    };
  };
  const articles = [article(1, 'Promoted'), article(2, 'repost'), article(3, 'Boosted'), article(4, 'normal', true),
    ...Array.from({ length: 8 }, (_, i) => article(i + 10, bodyMentionsRepost ? 'リポストお願いします' : 'normal'))];
  const timers = [];
  const window = { scrollTo: () => { scrolls++; }, scrollBy: options => { scrolls++; scrollSteps.push(options.top); } };
  const chrome = {
    webview: {
      postMessage: message => {
        trustedMessages.push(message);
        const match = /^homepanel:x-like:(\d+):(\d+):(\d+)$/.exec(message);
        if (!match) return;
        clicks++;
        clickedIds.push(Number(match[1]));
        clickTimes.push(now);
        markLiked.get(match[1])?.();
      },
    },
  };
  const context = vm.createContext({
    location: { hostname: 'x.com' }, window, chrome, innerWidth: 720, innerHeight: 480,
    document: { readyState: 'complete', querySelectorAll: selector => selector === '[role="tab"]' ? (missingTab ? [] : [tab]) : (now < emptyUntil ? [] : articles) },
    performance: { now: () => now },
    setTimeout: (callback, delay) => timers.push(() => { now += delay + (delayedTimers ? 2500 : 0); callback(); }),
  });
  vm.runInContext(source, context);
  for (let i = 0; i < 100 && !window.__homePanelXLikeRuntime.completed; i++) {
    timers.shift()?.();
    await Promise.resolve();
    await Promise.resolve();
  }
  // Reinjection must not run the same batch again.
  vm.runInContext(source, context);
  return { clicks, domLikeClicks, clickedIds, trustedMessages, clickTimes, scrollSteps, scrolls, tabClicks, state: window.__homePanelXLikeRuntime };
}

test('scrolls slowly and requests one trusted like every ten seconds for one minute', async () => {
  const result = await run();
  assert.deepEqual(result.clickedIds, [10, 11, 12, 13, 14]);
  assert.equal(result.domLikeClicks, 0);
  assert.equal(result.state.likedCount, 5);
  assert.equal(result.state.attemptedCount, 5);
  assert.ok(result.trustedMessages.every(message => /^homepanel:x-like:\d+:52:32$/.test(message)));
  assert.ok(result.clickTimes[0] >= 10000);
  for (let i = 1; i < result.clickTimes.length; i++) {
    assert.ok(result.clickTimes[i] - result.clickTimes[i - 1] >= 10000);
  }
  assert.ok(result.clickTimes.every(time => time < 60000));
  assert.ok(result.scrollSteps.length > 40);
  assert.ok(result.scrollSteps.every(step => step === 28));
  assert.equal(result.state.completed, true);
});

test('native bridge converts X coordinate messages to CDP mouse input', () => {
  assert.match(source, /bridge\.postMessage\(`homepanel:x-like:\$\{id\}:\$\{x\}:\$\{y\}`\)/);
  assert.doesNotMatch(source, /button\.click\(\)/);
  assert.match(mediaSection, /sourceContains\(L"x\.com\/home"\)/);
  assert.match(mediaSection, /homepanel:x-like:%llu:%d:%d/);
  assert.match(mediaSection, /NativeMediaDispatchTrustedCssClick/);
  assert.match(mediaSection, /NativeMediaTrustedMouseParams\(L"mouseMoved"/);
  assert.match(mediaSection, /NativeMediaTrustedMouseParams\(L"mousePressed"/);
  assert.match(mediaSection, /NativeMediaTrustedMouseParams\(\s*L"mouseReleased"/);
  assert.match(mediaSection, /script == kNativeMediaYoutubeCleanPlayerScript[\s\S]*NativeMediaEnsureEventWakeBridge/);
});

test('delayed timers and late posts never cause catch-up bursts', async () => {
  for (const options of [{ delayedTimers: true }, { emptyUntil: 32000 }]) {
    const result = await run(options);
    assert.ok(result.clickTimes.length > 0);
    for (let i = 1; i < result.clickTimes.length; i++) {
      assert.ok(result.clickTimes[i] - result.clickTimes[i - 1] >= 10000);
    }
    assert.ok(result.clickTimes.every(time => time < 60000));
    assert.equal(result.domLikeClicks, 0);
  }
});

test('does not interact before login or like when Following cannot be selected', async () => {
  const loggedOut = await run({ missingTab: true });
  assert.equal(loggedOut.clicks + loggedOut.scrolls + loggedOut.tabClicks, 0);
  assert.equal(loggedOut.state.result, 'login-timeout');
  const failedSwitch = await run({ selected: false, switchWorks: false });
  assert.equal(failedSwitch.clicks, 0);
  assert.equal(failedSwitch.state.result, 'following-unavailable');
  assert.equal((await run({ selected: false })).clicks, 5);
});

test('failed trusted likes are not retried or counted as confirmed likes', async () => {
  const result = await run({ failLike: true });
  assert.equal(result.clicks, 5);
  assert.equal(result.domLikeClicks, 0);
  assert.equal(result.state.likedCount, 0);
});

test('stops liking if the user leaves Following', async () => {
  assert.equal((await run({ leaveFollowing: true })).clicks, 1);
});

test('ordinary posts mentioning reposts are not mistaken for reposts', async () => {
  const result = await run({ bodyMentionsRepost: true });
  assert.deepEqual(result.clickedIds, [10, 11, 12, 13, 14]);
});
