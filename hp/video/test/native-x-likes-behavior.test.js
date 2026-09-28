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
  let scrollOffset = 0;
  const clickTimes = [];
  const trustedMessages = [];
  const scrollSteps = [];
  const scrollTimes = [];
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
  const article = (id, label = 'normal', initiallyLiked = false, baseTop = 0) => {
    let liked = initiallyLiked;
    markLiked.set(String(id), () => {
      if (!failLike) liked = true;
      if (leaveFollowing) selectedTab = false;
    });
    return {
      isConnected: true,
      innerText: label,
      getBoundingClientRect: () => {
        const top = baseTop - scrollOffset;
        return { top, bottom: top + 160 };
      },
      querySelectorAll(selector) {
        return selector === 'span' ? [] : [];
      },
      querySelector(selector) {
        if (selector === '[data-testid="socialContext"]') return label === 'repost' ? { innerText: 'user reposted' } : null;
        if (selector.includes('placement')) return null;
        if (selector === 'time') return { closest: () => ({ getAttribute: () => `/user/status/${id}` }) };
        if (selector === '[data-testid="unlike"]') return liked ? {} : null;
        if (selector === '[data-testid="like"]') return liked ? null : {
          disabled: false,
          getAttribute: () => null,
          getBoundingClientRect: () => ({
            left: 40,
            top: baseTop + 96 - scrollOffset,
            width: 24,
            height: 24,
          }),
          click: () => { domLikeClicks++; },
        };
        return null;
      },
    };
  };
  const articles = [
    article(1, 'Promoted', false, 40),
    article(2, 'repost', false, 90),
    article(3, 'Boosted', false, 140),
    article(4, 'normal', true, 190),
    ...Array.from({ length: 8 }, (_, i) => article(
      i + 10,
      bodyMentionsRepost ? 'リポストお願いします' : 'normal',
      false,
      320 + i * 220,
    )),
  ];
  const timers = [];
  const window = {
    scrollTo: (_x, y) => { scrolls++; scrollOffset = Math.max(0, Number(y) || 0); },
    scrollBy: options => {
      scrolls++;
      const step = Number(options.top) || 0;
      scrollOffset = Math.max(0, scrollOffset + step);
      scrollSteps.push(step);
      scrollTimes.push(now);
    },
  };
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
    document: {
      readyState: 'complete',
      querySelectorAll: selector => selector === '[role="tab"]'
        ? (missingTab ? [] : [tab])
        : (now < emptyUntil ? [] : articles),
    },
    performance: { now: () => now },
    setTimeout: (callback, delay) => timers.push(() => {
      now += delay + (delayedTimers ? 2500 : 0);
      callback();
    }),
  });
  vm.runInContext(source, context);
  for (let i = 0; i < 500 && !window.__homePanelXLikeRuntime.completed; i++) {
    timers.shift()?.();
    await Promise.resolve();
    await Promise.resolve();
  }
  // Reinjection must not run the same batch again.
  vm.runInContext(source, context);
  return {
    clicks,
    domLikeClicks,
    clickedIds,
    trustedMessages,
    clickTimes,
    scrollSteps,
    scrollTimes,
    scrolls,
    tabClicks,
    state: window.__homePanelXLikeRuntime,
  };
}

test('slowly approaches a like button, pauses there, then sends one trusted click', async () => {
  const result = await run();
  assert.deepEqual(result.clickedIds, [10, 11, 12, 13, 14]);
  assert.equal(result.domLikeClicks, 0);
  assert.equal(result.state.likedCount, 5);
  assert.equal(result.state.attemptedCount, 5);
  assert.ok(result.trustedMessages.every(message => {
    const match = /^homepanel:x-like:\d+:(\d+):(\d+)$/.exec(message);
    if (!match) return false;
    const y = Number(match[2]);
    return Number(match[1]) === 52 && y >= 280 && y <= 316;
  }));
  assert.ok(result.clickTimes[0] >= 10000);
  for (let i = 1; i < result.clickTimes.length; i++) {
    assert.ok(result.clickTimes[i] - result.clickTimes[i - 1] >= 10000);
  }
  for (const clickTime of result.clickTimes) {
    const previousScroll = result.scrollTimes.filter(time => time <= clickTime).at(-1);
    assert.ok(previousScroll != null);
    assert.ok(clickTime - previousScroll >= 900);
  }
  assert.ok(result.clickTimes.every(time => time < 60000));
  assert.ok(result.scrollSteps.length > 10);
  assert.ok(result.scrollSteps.every(step => step > 0 && step <= 28));
  assert.ok(result.scrollSteps.some(step => step < 28));
  assert.equal(result.state.completed, true);
});

test('runtime explicitly models approach, pause, click and post-click pause phases', () => {
  assert.match(source, /const pauseBeforeLikeMs = 900/);
  assert.match(source, /const pauseAfterLikeMs = 800/);
  assert.match(source, /const maxScrollStepPx = 28/);
  assert.match(source, /const targetY = \(\) => Math\.round\(innerHeight \* 0\.62\)/);
  assert.match(source, /state\.result = 'approaching-like'/);
  assert.match(source, /state\.result = 'paused-on-like'/);
  assert.match(source, /await sleep\(pauseBeforeLikeMs\)/);
  assert.match(source, /state\.result = 'like-clicked'/);
  assert.match(source, /await sleep\(pauseAfterLikeMs\)/);
  assert.match(source, /Math\.min\(maxScrollStepPx, Math\.ceil\(Math\.abs\(distance\) \* 0\.35\)\)/);
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
  const late = await run({ emptyUntil: 32000 });
  assert.ok(late.scrollSteps.every(step => step > 0));
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
