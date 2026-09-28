import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source = readFileSync(new URL('../../native/src/renderer_panels/media_x_following_like.inc', import.meta.url), 'utf8')
  .replace(/^LR"JS\(/, '').replace(/\)JS"\s*$/, '');

async function run({ random = 0, selected = true, switchWorks = true, missingTab = false, failLike = false, leaveFollowing = false, bodyMentionsRepost = false } = {}) {
  let clicks = 0;
  const clickedIds = [];
  let scrolls = 0;
  let tabClicks = 0;
  let selectedTab = selected;
  const tab = {
    innerText: 'フォロー中',
    getAttribute: () => String(selectedTab),
    click: () => { tabClicks++; if (switchWorks) selectedTab = true; },
  };
  const article = (id, label = 'normal', liked = false) => ({
    isConnected: true,
    innerText: label,
    getBoundingClientRect: () => ({ top: 10, bottom: 100 }),
    querySelector(selector) {
      if (selector === '[data-testid="socialContext"]') return label === 'repost' ? { innerText: 'user reposted' } : null;
      if (selector.includes('placement')) return null;
      if (selector === 'time') return { closest: () => ({ getAttribute: () => `/user/status/${id}` }) };
      if (selector === '[data-testid="unlike"]') return liked ? {} : null;
      if (selector === '[data-testid="like"]') return liked ? null : {
        getAttribute: () => null,
        click: () => { clicks++; clickedIds.push(id); if (!failLike) liked = true; if (leaveFollowing) selectedTab = false; },
      };
      return null;
    },
  });
  const articles = [article(1, 'Promoted'), article(2, 'repost'), article(3, 'Boosted'), article(4, 'normal', true),
    ...Array.from({ length: 8 }, (_, i) => article(i + 10, bodyMentionsRepost ? 'リポストお願いします' : 'normal'))];
  const timers = [];
  const window = { scrollTo: () => { scrolls++; }, scrollBy: () => { scrolls++; } };
  const context = vm.createContext({
    location: { hostname: 'x.com' }, window, innerHeight: 480,
    document: { readyState: 'complete', querySelectorAll: selector => selector === '[role="tab"]' ? (missingTab ? [] : [tab]) : articles },
    Math: Object.assign(Object.create(Math), { random: () => random }),
    setTimeout: callback => timers.push(callback),
  });
  vm.runInContext(source, context);
  for (let i = 0; i < 100 && !window.__homePanelXLikeRuntime.completed; i++) {
    timers.shift()?.();
    await Promise.resolve();
    await Promise.resolve();
  }
  // Reinjection must not run the same batch again.
  vm.runInContext(source, context);
  return { clicks, clickedIds, scrolls, tabClicks, state: window.__homePanelXLikeRuntime };
}

test('likes only eligible posts, with random limits of two through five', async () => {
  for (const [random, count] of [[0, 2], [0.999, 5]]) {
    const result = await run({ random });
    assert.equal(result.clicks, count);
    assert.deepEqual(result.clickedIds, Array.from({ length: count }, (_, i) => i + 10));
    assert.equal(result.state.likedCount, count);
    assert.equal(result.state.attemptedCount, count);
    assert.equal(result.state.completed, true);
  }
});

test('does not interact before login or like when Following cannot be selected', async () => {
  const loggedOut = await run({ missingTab: true });
  assert.equal(loggedOut.clicks + loggedOut.scrolls + loggedOut.tabClicks, 0);
  assert.equal(loggedOut.state.result, 'waiting-login');
  const failedSwitch = await run({ selected: false, switchWorks: false });
  assert.equal(failedSwitch.clicks, 0);
  assert.equal(failedSwitch.state.result, 'following-unavailable');
  assert.equal((await run({ selected: false })).clicks, 2);
});

test('failed likes are not retried or counted as confirmed likes', async () => {
  const result = await run({ failLike: true });
  assert.equal(result.clicks, 2);
  assert.equal(result.state.likedCount, 0);
});

test('stops liking if the user leaves Following', async () => {
  assert.equal((await run({ leaveFollowing: true })).clicks, 1);
});


test('ordinary posts mentioning reposts are not mistaken for reposts', async () => {
  const result = await run({ bodyMentionsRepost: true });
  assert.deepEqual(result.clickedIds, [10, 11]);
});
