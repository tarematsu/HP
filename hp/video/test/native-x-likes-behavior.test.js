import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const rawSource = readFileSync(
  new URL('../../native/src/renderer_panels/media_x_following_like.inc', import.meta.url), 'utf8');
const source = [...rawSource.matchAll(/LR"JS\(([\s\S]*?)\)JS"/g)]
  .map(([, chunk]) => chunk).join('');

async function run({ selected = true, switchWorks = true, missingTab = false, failLike = false, leaveFollowing = false, bodyMentionsRepost = false, bodyMentionsAd = false, delayedTimers = false, emptyUntil = 0 } = {}) {
  let now = 0;
  let scrollOffset = 0;
  const clickTimes = [];
  const scrollSteps = [];
  const scrollTimes = [];
  const clickedIds = [];
  let scrolls = 0;
  let tabClicks = 0;
  let selectedTab = selected;
  const tab = {
    innerText: 'フォロー中',
    getAttribute: () => String(selectedTab),
    click: () => { tabClicks++; if (switchWorks) selectedTab = true; },
  };
  const article = (id, label = 'normal', initiallyLiked = false, baseTop = 0, options = {}) => {
    let liked = initiallyLiked;
    const likeButton = {
      disabled: false,
      getAttribute: () => null,
      getBoundingClientRect: () => ({
        left: 40,
        top: baseTop + 96 - scrollOffset,
        width: 24,
        height: 24,
      }),
      click: () => {
        clickedIds.push(id);
        clickTimes.push(now);
        if (!failLike) liked = true;
        if (leaveFollowing) selectedTab = false;
      },
    };
    return {
      isConnected: true,
      innerText: label,
      getBoundingClientRect: () => {
        const top = baseTop - scrollOffset;
        return { top, bottom: top + 160 };
      },
      querySelectorAll(selector) {
        if (selector !== 'span') return [];
        return [{
          innerText: label,
          closest: query => options.promoted
            ? null
            : (query === '[data-testid="tweetText"]' ? {} : null),
        }];
      },
      querySelector(selector) {
        if (selector === '[data-testid="socialContext"]') {
          if (options.socialContext) return { innerText: options.socialContext };
          return label === 'repost' ? { innerText: 'user reposted' } : null;
        }
        if (selector.includes('placement')) return options.placement ? {} : null;
        if (selector === 'time') return { closest: () => ({ getAttribute: () => `/user/status/${id}` }) };
        if (selector === '[data-testid="unlike"]') return liked ? {} : null;
        if (selector === '[data-testid="like"]') return liked ? null : likeButton;
        return null;
      },
    };
  };
  const normalLabel = bodyMentionsAd
    ? '広告'
    : (bodyMentionsRepost ? 'リポストお願いします' : 'normal');
  const articles = [
    article(1, 'Promoted', false, 40, { promoted: true }),
    article(2, 'repost', false, 90, { socialContext: 'user reposted' }),
    article(3, 'Boosted', false, 140, { promoted: true }),
    article(4, 'normal', true, 190),
    ...Array.from({ length: 8 }, (_, i) => article(
      i + 10,
      normalLabel,
      false,
      320 + i * 220,
      i === 0 ? { socialContext: 'Pinned' } : {},
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
  const context = vm.createContext({
    location: { hostname: 'x.com' }, window, innerWidth: 720, innerHeight: 480,
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
  for (let i = 0; i < 700 && !window.__homePanelXLikeRuntime.completed; i++) {
    timers.shift()?.();
    await Promise.resolve();
    await Promise.resolve();
  }
  vm.runInContext(source, context);
  return {
    clickedIds,
    clickTimes,
    scrollSteps,
    scrollTimes,
    scrolls,
    tabClicks,
    state: window.__homePanelXLikeRuntime,
  };
}

test('slowly approaches a like button, pauses there, then uses the same DOM click style as Following', async () => {
  const result = await run();
  assert.deepEqual(result.clickedIds, [10, 11, 12, 13, 14]);
  assert.equal(result.state.likedCount, 5);
  assert.equal(result.state.attemptedCount, 5);
  assert.equal(result.state.clickCount, 5);
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

test('runtime explicitly uses click() for both Following and like buttons', () => {
  assert.match(source, /tab\.click\(\)/);
  assert.match(source, /const clickLikeButton = button =>/);
  assert.match(source, /button\.click\(\)/);
  assert.doesNotMatch(source, /homepanel:x-like:/);
  assert.match(source, /state\.result = 'like-clicked'/);
  assert.match(source, /state\.result = 'like-confirmed'/);
});

test('unconfirmed DOM likes retry up to three times instead of being treated as successful', async () => {
  const result = await run({ failLike: true });
  assert.equal(result.state.likedCount, 0);
  assert.ok(result.state.unconfirmedCount > 0);
  const counts = new Map();
  for (const id of result.clickedIds) counts.set(id, (counts.get(id) || 0) + 1);
  assert.ok([...counts.values()].every(count => count <= 3));
  assert.ok([...counts.values()].some(count => count === 3));
});

test('runtime keeps slow targeted scrolling and pauses before clicks', () => {
  assert.match(source, /const pauseBeforeLikeMs = 900/);
  assert.match(source, /const pauseAfterLikeMs = 800/);
  assert.match(source, /const maxScrollStepPx = 28/);
  assert.match(source, /const targetY = \(\) => Math\.round\(innerHeight \* 0\.62\)/);
  assert.match(source, /state\.result = 'approaching-like'/);
  assert.match(source, /state\.result = 'paused-on-like'/);
  assert.match(source, /await sleep\(pauseBeforeLikeMs\)/);
  assert.match(source, /Math\.min\(maxScrollStepPx, Math\.ceil\(Math\.abs\(distance\) \* 0\.35\)\)/);
});

test('delayed timers and late posts never cause confirmed-like catch-up bursts', async () => {
  for (const options of [{ delayedTimers: true }, { emptyUntil: 32000 }]) {
    const result = await run(options);
    assert.ok(result.clickTimes.length > 0);
    for (let i = 1; i < result.clickTimes.length; i++) {
      assert.ok(result.clickTimes[i] - result.clickTimes[i - 1] >= 10000);
    }
    assert.ok(result.clickTimes.every(time => time < 60000));
  }
  const late = await run({ emptyUntil: 32000 });
  assert.ok(late.scrollSteps.every(step => step > 0));
});

test('does not interact before login or like when Following cannot be selected', async () => {
  const loggedOut = await run({ missingTab: true });
  assert.equal(loggedOut.clickedIds.length + loggedOut.scrolls + loggedOut.tabClicks, 0);
  assert.equal(loggedOut.state.result, 'login-timeout');
  const failedSwitch = await run({ selected: false, switchWorks: false });
  assert.equal(failedSwitch.clickedIds.length, 0);
  assert.equal(failedSwitch.state.result, 'following-unavailable');
  assert.equal((await run({ selected: false })).state.likedCount, 5);
});

test('stops liking if the user leaves Following', async () => {
  assert.equal((await run({ leaveFollowing: true })).clickedIds.length, 1);
});

test('ordinary posts mentioning reposts are not mistaken for reposts', async () => {
  const result = await run({ bodyMentionsRepost: true });
  assert.deepEqual(result.clickedIds, [10, 11, 12, 13, 14]);
});

test('ordinary tweet text mentioning ads or PR is not mistaken for promotion', async () => {
  const result = await run({ bodyMentionsAd: true });
  assert.deepEqual(result.clickedIds, [10, 11, 12, 13, 14]);
});

test('filter CSS does not hide every social-context post', () => {
  assert.doesNotMatch(source, /article\[data-testid="tweet"\]:has\(\[data-testid="socialContext"\]\)/);
  assert.doesNotMatch(source, /cellInnerDiv[^`]*socialContext/);
  assert.doesNotMatch(source, /const promotedText/);
  assert.match(source, /!element\.closest\?\.\('\[data-testid="tweetText"\]'\)/);
});
