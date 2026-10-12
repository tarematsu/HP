import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const rawSource = readFileSync(
  new URL('../../native/src/renderer_panels/media_x_following_like.inc', import.meta.url), 'utf8');
const source = [...rawSource.matchAll(/LR"JS\(([\s\S]*?)\)JS"/g)]
  .map(([, chunk]) => chunk).join('');

async function run({
  selected = true,
  switchWorks = true,
  missingTab = false,
  failLike = false,
  leaveFollowing = false,
  bodyMentionsRepost = false,
  bodyMentionsAd = false,
  delayedTimers = false,
  emptyUntil = 0,
  randomValues = [0],
  authors = {},
  permalinkOverrides = {},
  storage = new Map(),
  wallClockAt = 1800000000000,
} = {}) {
  let now = 0;
  let scrollOffset = 0;
  let randomIndex = 0;
  const clickTimes = [];
  const scrollSteps = [];
  const scrollTimes = [];
  const clickedIds = [];
  let scrolls = 0;
  let tabClicks = 0;
  let selectedTab = selected;
  const domBudget = {
    timelineQueries: 0, filterSets: 0, filterRemovals: 0, hiddenIds: new Set(),
  };
  const tab = {
    innerText: 'フォロー中',
    getAttribute: () => String(selectedTab),
    click: () => { tabClicks++; if (switchWorks) selectedTab = true; },
  };
  const article = (id, label = 'normal', initiallyLiked = false, baseTop = 0, options = {}) => {
    let liked = initiallyLiked;
    let filtered = false;
    const existingLikes = options.likeCount ?? 8;
    const countText = String(existingLikes);
    const likeButton = {
      disabled: false,
      innerText: countText,
      textContent: countText,
      getAttribute: name => name === 'aria-label' ? `${countText} Likes` : null,
      querySelector: selector => selector === '[data-testid="app-text-transition-container"]'
        ? { innerText: countText, textContent: countText }
        : null,
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
      getAttribute: key => key === 'data-homepanel-x-filtered' && filtered ? 'true' : null,
      hasAttribute: key => key === 'data-homepanel-x-filtered' && filtered,
      setAttribute: (key, value) => {
        if (key !== 'data-homepanel-x-filtered') return;
        domBudget.filterSets++;
        filtered = value === 'true';
        if (filtered) domBudget.hiddenIds.add(id);
      },
      removeAttribute: key => {
        if (key !== 'data-homepanel-x-filtered') return;
        domBudget.filterRemovals++;
        filtered = false;
        domBudget.hiddenIds.delete(id);
      },
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
        if (selector === 'time') return { closest: () => ({ getAttribute: () => options.permalink ?? `/${options.author ?? `user${id}`}/status/${id}` }) };
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
    article(1, 'Promoted', false, 40, { promoted: true, likeCount: 50 }),
    article(2, 'repost', false, 90, { socialContext: 'user reposted', likeCount: 50 }),
    article(3, 'Boosted', false, 140, { promoted: true, likeCount: 50 }),
    article(4, 'normal', true, 190, { likeCount: 50 }),
    ...Array.from({ length: 8 }, (_, i) => article(
      i + 10,
      normalLabel,
      false,
      320 + i * 220,
      {
        ...(i === 0 ? { socialContext: 'Pinned' } : {}),
        ...(Object.hasOwn(authors, i + 10) ? { author: authors[i + 10] } : {}),
        ...(Object.hasOwn(permalinkOverrides, i + 10)
            ? { permalink: permalinkOverrides[i + 10] } : {}),
        likeCount: i === 0 ? 4 : 5 + i,
      },
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
  const testMath = {
    abs: Math.abs,
    max: Math.max,
    min: Math.min,
    ceil: Math.ceil,
    round: Math.round,
    floor: Math.floor,
    sign: Math.sign,
    random: () => {
      const value = randomValues[randomIndex % randomValues.length];
      randomIndex++;
      return value;
    },
  };
  const context = vm.createContext({
    location: { hostname: 'x.com' }, window, innerWidth: 720, innerHeight: 480,
    Math: testMath,
    Date: { now: () => wallClockAt + now },
    localStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => { storage.set(key, value); },
    },
    document: {
      readyState: 'complete',
      querySelectorAll: selector => {
        if (selector === '[role="tab"]') return missingTab ? [] : [tab];
        if (selector === 'article[data-testid="tweet"]') {
          domBudget.timelineQueries++;
          return now < emptyUntil ? [] : articles;
        }
        return [];
      },
    },
    performance: { now: () => now },
    setTimeout: (callback, delay) => timers.push(() => {
      now += delay + (delayedTimers ? 2500 : 0);
      callback();
    }),
  });
  vm.runInContext(source, context);
  for (let i = 0; i < 900 && !window.__homePanelXLikeRuntime.completed; i++) {
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
    domBudget,
    storage,
  };
}

test('approaches like buttons at the restored scroll speed and uses the same DOM click style as Following', async () => {
  const result = await run({ randomValues: [0] });
  assert.ok(result.clickedIds.length >= 4);
  assert.ok(result.clickedIds.every(id => id >= 10));
  assert.equal(result.state.likedCount, result.clickedIds.length);
  assert.equal(result.state.clickCount, result.clickedIds.length);
  assert.ok(result.scrollSteps.length > 4);
  assert.ok(result.scrollSteps.every(step => step > 0 && step <= 56));
  assert.ok(result.scrollSteps.some(step => step < 70));
  assert.equal(result.state.completed, true);
});

test('existing like count does not restrict eligible posts', async () => {
  const result = await run({ randomValues: [0] });
  assert.ok(result.clickedIds.includes(10));
  assert.ok(result.clickedIds.some(id => id >= 11));
  assert.doesNotMatch(source, /minimumExistingLikes/);
  assert.doesNotMatch(source, /existingLikeCount/);
  assert.doesNotMatch(source, /parseCompactCount/);
});

test('pre-click wait is randomly selected from 4, 7 and 9 seconds', async () => {
  const result = await run({ randomValues: [0, 0.34, 0.67, 0] });
  assert.ok(result.state.likeWaitHistoryMs.length >= 4);
  assert.deepEqual(
    Array.from(result.state.likeWaitHistoryMs.slice(0, 4)),
    [4000, 7000, 9000, 4000],
  );
  assert.ok(result.state.likeWaitHistoryMs.every(ms => [4000, 7000, 9000].includes(ms)));
  for (let i = 0; i < Math.min(result.clickTimes.length, result.state.likeWaitHistoryMs.length); i++) {
    const previousScroll = result.scrollTimes.filter(time => time <= result.clickTimes[i]).at(-1);
    assert.ok(previousScroll != null);
    assert.ok(result.clickTimes[i] - previousScroll >= result.state.likeWaitHistoryMs[i]);
  }
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
  const result = await run({ failLike: true, randomValues: [0] });
  assert.equal(result.state.likedCount, 0);
  assert.ok(result.state.unconfirmedCount > 0);
  const counts = new Map();
  for (const id of result.clickedIds) counts.set(id, (counts.get(id) || 0) + 1);
  assert.ok([...counts.values()].every(count => count <= 3));
  assert.ok([...counts.values()].some(count => count === 3));
});

test('runtime uses restored targeted scroll increments and waits before each click', () => {
  assert.match(source, /const maxScrollStepPx = 56/);
  assert.match(source, /const minScrollStepPx = 20/);
  assert.match(source, /const targetY = \(\) => Math\.round\(innerHeight \* 0\.62\)/);
  assert.match(source, /state\.result = 'approaching-like'/);
  assert.match(source, /state\.result = 'paused-on-like'/);
  assert.match(source, /state\.result = 'waiting-before-like'/);
  assert.match(source, /await sleep\(waitMs\)/);
  assert.match(source, /Math\.min\(maxScrollStepPx, Math\.ceil\(Math\.abs\(distance\) \* 0\.70\)\)/);
});

test('delayed timers and late posts never cause catch-up bursts', async () => {
  for (const options of [
    { delayedTimers: true, randomValues: [0] },
    { emptyUntil: 32000, randomValues: [0] },
  ]) {
    const result = await run(options);
    assert.ok(result.clickTimes.length > 0);
    for (let i = 1; i < result.clickTimes.length; i++) {
      assert.ok(result.clickTimes[i] - result.clickTimes[i - 1] >= 4000);
    }
    assert.ok(result.clickTimes.every(time => time < 120000));
  }
  const late = await run({ emptyUntil: 32000, randomValues: [0] });
  assert.ok(late.scrollSteps.every(step => step > 0));
});

test('does not interact before login or like when Following cannot be selected', async () => {
  const loggedOut = await run({ missingTab: true });
  assert.equal(loggedOut.clickedIds.length + loggedOut.scrolls + loggedOut.tabClicks, 0);
  assert.equal(loggedOut.state.result, 'login-timeout');
  const failedSwitch = await run({ selected: false, switchWorks: false });
  assert.equal(failedSwitch.clickedIds.length, 0);
  assert.equal(failedSwitch.state.result, 'following-unavailable');
  assert.ok((await run({ selected: false, randomValues: [0] })).state.likedCount > 0);
});

test('stops liking if the user leaves Following', async () => {
  assert.equal((await run({ leaveFollowing: true, randomValues: [0] })).clickedIds.length, 1);
});

test('ordinary posts mentioning reposts are not mistaken for reposts', async () => {
  const result = await run({ bodyMentionsRepost: true, randomValues: [0] });
  assert.ok(result.clickedIds.length > 0);
  assert.ok(result.clickedIds.every(id => id >= 10));
});

test('ordinary tweet text mentioning ads or PR is not mistaken for promotion', async () => {
  const result = await run({ bodyMentionsAd: true, randomValues: [0] });
  assert.ok(result.clickedIds.length > 0);
  assert.ok(result.clickedIds.every(id => id >= 10));
});

test('filter CSS does not hide every social-context post', () => {
  assert.doesNotMatch(source, /article\[data-testid="tweet"\]:has\(\[data-testid="socialContext"\]\)/);
  assert.doesNotMatch(source, /cellInnerDiv[^`]*socialContext/);
  assert.doesNotMatch(source, /const promotedText/);
  assert.match(source, /!element\.closest\?\.\('\[data-testid="tweetText"\]'\)/);
});


test('one fresh timeline query per scan, with no full candidate sort or array copies', async () => {
  const result = await run({ randomValues: [0] });
  assert.ok(result.state.likedCount >= 4);
  assert.match(source, /const articles = timelineArticles\(\);\s*const candidate = scanTimeline\(articles, attempted\);/);
  assert.doesNotMatch(source, /Array\.from\(/);
  assert.doesNotMatch(source, /candidates\.sort\(/);
  assert.doesNotMatch(source, /markFilteredArticles\(\)/);
  assert.ok(result.domBudget.timelineQueries > 0);
});

test('promoted and repost filter attributes are not rewritten on every scroll tick', async () => {
  const result = await run({ randomValues: [0] });
  // Three promoted/repost posts plus at most one new hide per liked author.
  // Each remains hidden without repeated attribute writes on later scans.
  assert.ok(result.domBudget.filterSets >= 3);
  assert.ok(result.domBudget.filterSets <= 3 + result.state.likedCount);
  assert.equal(result.domBudget.filterRemovals, 0);
  assert.ok(result.domBudget.timelineQueries > result.domBudget.filterSets * 3);
});


test('X Following tab lookup reuses the attached tab and refreshes on SPA replacement', () => {
  const start = source.indexOf('  const followingTab = () => {');
  const end = source.indexOf('  const startupRequested =', start);
  assert.ok(start >= 0 && end > start);
  const state = {};
  let searches = 0;
  let tabs = [];
  const following = { isConnected: true, textContent: 'フォロー中' };
  tabs = [following];
  const followingTab = vm.runInNewContext(
    '(() => { ' + source.slice(start, end) + '\nreturn followingTab; })()',
    {
      state,
      document: { querySelectorAll: selector => {
        assert.equal(selector, '[role="tab"]');
        searches++;
        return tabs;
      } },
      text: tab => tab.textContent,
    },
  );
  assert.equal(followingTab(), following);
  for (let i = 0; i < 100; i++) assert.equal(followingTab(), following);
  assert.equal(searches, 1, 'stable Following tab should avoid repeat queries');

  following.isConnected = false;
  const replacement = { isConnected: true, textContent: 'Following' };
  tabs = [replacement];
  assert.equal(followingTab(), replacement);
  assert.equal(searches, 2);

  replacement.textContent = 'For you';
  tabs = [];
  assert.equal(followingTab(), null);
  assert.equal(searches, 3, 'reused node with a changed caption must be rejected');
});

test('X promotion and repost probes avoid rendered-text layout reads on unrelated nodes', () => {
  const start = source.indexOf('  const promotedLabel =');
  const end = source.indexOf('  const installTimelineFilterCss =', start);
  assert.ok(start >= 0 && end > start);
  const detectors = vm.runInNewContext(
    '(() => { ' + source.slice(start, end) +
      '\nreturn { hasPromotedLabel, isPromoted, isRepost, isOrganic }; })()',
    { text: element => (element?.innerText || element?.textContent || '')
        .replace(/\s+/g, ' ').trim() },
  );
  let renderedReads = 0;
  const span = (content, rendered = content, body = false) => ({
    textContent: content,
    get innerText() { renderedReads++; return rendered; },
    closest: selector => selector === '[data-testid="tweetText"]' && body ? {} : null,
  });
  const ordinary = Array.from({ length: 100 }, (_, i) => span('ordinary ' + i));
  const article = (spans, social = null, placement = false) => ({
    querySelectorAll: selector => {
      assert.equal(selector, 'span');
      return spans;
    },
    querySelector: selector => {
      if (selector.includes('placement')) return placement ? {} : null;
      if (selector === '[data-testid="socialContext"]') return social;
      return null;
    },
  });
  assert.equal(detectors.isOrganic(article(ordinary)), true);
  assert.equal(renderedReads, 0, 'ordinary tweet spans should not read innerText');

  const promotion = article([...ordinary, span('Promoted')]);
  assert.equal(detectors.isPromoted(promotion), true);
  assert.equal(renderedReads, 1, 'only promotion candidates need rendered verification');

  renderedReads = 0;
  assert.equal(detectors.isPromoted(article(ordinary, null, true)), true);
  assert.equal(renderedReads, 0, 'explicit placement should short-circuit span scanning');
  assert.equal(detectors.isPromoted(article([span('広告', '広告', true)])), false);

  const pinned = span('Pinned');
  assert.equal(detectors.isRepost(article([], pinned)), false);
  assert.equal(renderedReads, 0, 'pinned context must not force layout');
  const repost = span('user reposted');
  assert.equal(detectors.isRepost(article([], repost)), true);
  assert.equal(renderedReads, 1);

  renderedReads = 0;
  assert.equal(detectors.isPromoted(article([span('', 'Sponsored')])), true);
  assert.equal(detectors.isRepost(article([], span('', 'retweeted'))), true);
  assert.equal(renderedReads, 2, 'empty textContent still validates rendered labels');
});


test('a confirmed X like records @author and avoids all their posts for 48 hours', async () => {
  const storage = new Map();
  const authors = { 10: 'Sakura46', 11: 'sAkUrA46', 12: 'DifferentUser' };
  const first = await run({ authors, storage, randomValues: [0] });
  assert.ok(first.clickedIds.includes(10));
  assert.ok(!first.clickedIds.includes(11), 'same author must be skipped in the same X slot');
  assert.ok(first.clickedIds.includes(12), 'other authors remain eligible');
  const key = 'homepanel:x-liked-authors:48h:v1';
  const saved = JSON.parse(storage.get(key));
  assert.equal(typeof saved['@sakura46'], 'number');
  assert.equal(typeof saved['@differentuser'], 'number');
  assert.equal(first.state.authorHistoryPersisted, true);

  // Simulate another app launch with the same WebView2 storage 24 hours later.
  const next = await run({
    authors, storage, randomValues: [0], wallClockAt: 1800000000000 + 24 * 60 * 60 * 1000,
  });
  assert.equal(next.clickedIds.length, 0, 'all authors liked 24 hours ago are excluded');

  // After 49 hours, all previous authors become eligible again.
  const expired = await run({
    authors, storage, randomValues: [0], wallClockAt: 1800000000000 + 49 * 60 * 60 * 1000,
  });
  assert.ok(expired.clickedIds.includes(10));
  assert.ok(expired.clickedIds.includes(12));
});

test('unknown tweet authors are skipped rather than guessed from mentions or quote text', async () => {
  const result = await run({
    permalinkOverrides: { 10: '/i/status/not-a-number', 11: '/invalid/link' },
    randomValues: [0],
  });
  assert.ok(result.clickedIds.includes(12));
  assert.ok(!result.clickedIds.includes(10));
  assert.ok(!result.clickedIds.includes(11));
  assert.match(source, /const articleIdentity = article =>/);
  assert.match(source, /article\?\.querySelector\('time'\)\?\.closest\('a'\)/);
  assert.match(source, /author: '@' \+ match\[1\]\.toLowerCase\(\)/);
  assert.match(source, /if \(!eligible \|\| attempted\.has\(eligible\.id\) \|\|/);
  assert.match(source, /recentlyLikedAuthor\(identity\.author\)/);
  assert.match(source, /freshIdentity\.author !== candidate\.author/);
  assert.match(source, /recentlyLikedAuthor\(freshIdentity\.author\)/);
});

test('unconfirmed like clicks do not put an author in persistent 48-hour cooldown', async () => {
  const storage = new Map();
  const first = await run({ failLike: true, storage, randomValues: [0] });
  assert.equal(first.state.likedCount, 0);
  assert.ok(first.clickedIds.length > 0);
  assert.equal(storage.has('homepanel:x-liked-authors:48h:v1'), false);
  const second = await run({ storage, randomValues: [0] });
  assert.ok(second.clickedIds.includes(10), 'failed clicks must not block future confirmed likes');
});

test('old, malformed and future-dated author records are ignored and pruned', async () => {
  const storage = new Map([['homepanel:x-liked-authors:48h:v1',
    JSON.stringify({
      '@user10': 1800000000000 - 48 * 60 * 60 * 1000,
      '@user11': 1800000000000 + 999999,
      '@user12': 'bogus',
      '@wrong-handle': 1800000000000 - 1000,
      '@user13': 1800000000000 - 5000,
    })]]);
  const result = await run({ storage, randomValues: [0] });
  assert.ok(result.clickedIds.includes(10));
  assert.ok(result.clickedIds.includes(11));
  assert.ok(result.clickedIds.includes(12));
  assert.ok(!result.clickedIds.includes(13));
  const saved = JSON.parse(storage.get('homepanel:x-liked-authors:48h:v1'));
  assert.equal(Object.hasOwn(saved, '@wrong-handle'), false);
  assert.equal(typeof saved['@user13'], 'number');
});


test('posts by a confirmed liked author are collapsed while other accounts remain clickable', async () => {
  const storage = new Map();
  const result = await run({
    authors: { 10: 'Sakura46', 11: 'SAKURA46', 12: 'OtherAccount' },
    storage, randomValues: [0],
  });
  assert.ok(result.clickedIds.includes(10));
  assert.ok(result.domBudget.hiddenIds.has(10), 'confirmed post collapses on next scan');
  assert.ok(result.domBudget.hiddenIds.has(11), 'other posts from the same @handle collapse');
  assert.ok(!result.clickedIds.includes(11), 'collapsed account is never clicked twice');
  assert.ok(result.clickedIds.includes(12), 'unrelated account remains usable');
  assert.match(source, /const authorFiltered = !!\(identity && likedAuthors\.has\(identity\.author\) &&/);
  assert.match(source, /const hidden = filtered \|\| authorFiltered/);
  assert.match(source, /target = article\.closest\?\.\('\[data-testid="cellInnerDiv"\]'\) \|\| article/);
  assert.match(source, /if \(hidden\) \{[\s\S]*?target\.setAttribute\?\.\(filterAttribute, 'true'\)/);
  assert.match(source, /\[\$\{filterAttribute\}="true"\]/);
  assert.doesNotMatch(source, /article\.remove\(\)|target\.remove\(\)/);
});

test('only active 48-hour exclusions hide author cells; failed likes do not', async () => {
  const now = 1800000000000;
  const storage = new Map([['homepanel:x-liked-authors:48h:v1',
    JSON.stringify({
      '@user10': now - 47 * 60 * 60 * 1000,
      '@user11': now - 49 * 60 * 60 * 1000,
    })]]);
  const result = await run({ failLike: true, storage, wallClockAt: now, randomValues: [0] });
  assert.ok(result.domBudget.hiddenIds.has(10), 'active exclusion must collapse its cell');
  assert.ok(!result.domBudget.hiddenIds.has(11), 'expired exclusion must not hide its cell');
  assert.ok(!result.clickedIds.includes(10));
  assert.ok(result.clickedIds.includes(11));
  assert.ok(!result.domBudget.hiddenIds.has(12), 'unconfirmed likes do not hide posts');
  const saved = JSON.parse(storage.get('homepanel:x-liked-authors:48h:v1'));
  assert.equal(Object.hasOwn(saved, '@user11'), false, 'expiry pruned persistently');
});

test('X virtualization retains DOM nodes and unhides recycled or expired cells', () => {
  const start = source.indexOf('  const scanTimeline = (articles, attempted = null) => {');
  const end = source.indexOf('  const clickLikeButton =', start);
  assert.ok(start >= 0 && end > start);
  const body = source.slice(start, end);
  assert.match(body, /if \(target\.getAttribute\?\.\(filterAttribute\) !== 'true'\)/);
  assert.match(body, /target\.setAttribute\?\.\(filterAttribute, 'true'\)/);
  assert.match(body, /else if \(target\.hasAttribute\?\.\(filterAttribute\)\)/);
  assert.match(body, /target\.removeAttribute\?\.\(filterAttribute\)/);
  assert.match(body, /if \(!attempted \|\| hidden \|\| !article\.isConnected\) continue;/);
  assert.doesNotMatch(body, /\.remove\(\)|\.replaceChildren\(/);
});


test('X scroll cadence restores previous intervals without changing like waits', async () => {
  const targetedMs = Number(source.match(/const scrollDelayMs = (\d+);/)?.[1]);
  const seekingMs = Number(source.match(/const idleScrollDelayMs = (\d+);/)?.[1]);
  const emptyMs = Number(source.match(/const emptyTimelinePollMs = (\d+);/)?.[1]);
  assert.equal(targetedMs, 450);
  assert.equal(seekingMs, 600);
  assert.equal(emptyMs, 600);
  assert.match(source, /state\.result = 'waiting-posts';\s*await sleep\(emptyTimelinePollMs\)/);
  assert.match(source, /state\.result = 'seeking-like';[\s\S]*?window\.scrollBy\(\{ top: maxScrollStepPx, behavior: 'smooth' \}\);\s*await sleep\(idleScrollDelayMs\)/);
  assert.match(source, /window\.scrollBy\(\{ top: Math\.sign\(distance\) \* step, behavior: 'smooth' \}\);\s*await sleep\(scrollDelayMs\)/);
  assert.match(source, /const likeWaitChoicesMs = \[4 \* 1000, 7 \* 1000, 9 \* 1000\]/);
  assert.match(source, /const maxScrollStepPx = 56/);
  assert.match(source, /const minScrollStepPx = 20/);
  const result = await run({ randomValues: [0] });
  assert.ok(result.state.likedCount >= 4);
  assert.ok(result.scrollSteps.every(step => step > 0 && step <= 56));
});
