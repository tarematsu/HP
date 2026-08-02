import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const policy = readFileSync(
  new URL('../../native/src/sh_stats_session_policy_fix.h', import.meta.url),
  'utf8',
);
const fixture = JSON.parse(readFileSync(
  new URL('./fixtures/stationhead-streak-stats-2026-08-02.json', import.meta.url),
  'utf8',
));

function generatedStatsScript(channelId = 318) {
  const start = policy.indexOf(
    'inline std::wstring StationheadApiPlayStatsScriptStatsSessionSafe',
  );
  const end = policy.indexOf('\n}  // namespace hp', start);
  assert.ok(start >= 0 && end > start);
  const source = policy.slice(start, end);
  const tokens = [...source.matchAll(
    /LR"JS\(([\s\S]*?)\)JS"|script << channelId;/g,
  )];
  assert.ok(tokens.length >= 3, 'stats generator raw-string boundary is intact');
  assert.equal(tokens.filter(token => token[0] === 'script << channelId;').length, 1);
  return tokens.map(token => token[1] ?? String(channelId)).join('');
}

function makeHeaders(values = {}) {
  const entries = Object.entries(values).map(
    ([key, value]) => [key.toLowerCase(), value]);
  return {
    get(name) {
      const found = entries.find(
        ([key]) => key === String(name).toLowerCase());
      return found ? found[1] : null;
    },
  };
}

async function runStats({ response, reject, auth = 'Bearer fixture' } = {}) {
  const messages = [];
  const timers = [];
  const listeners = new Map();
  const window = {
    __homepanelStationheadAccountAuthHeaders: {
      authorization: auth,
      'sth-device-uid': 'fixture-device',
      'app-platform': 'web',
      'app-version': '1.0.0',
    },
    __homepanelStationheadAccountAuthGeneration: 7,
    __homepanelStationheadStatsAuthGeneration: 7,
    chrome: {
      webview: {
        postMessage(message) {
          messages.push(JSON.parse(JSON.stringify(message)));
        },
      },
    },
    setTimeout(callback, delay) {
      const id = timers.length + 1;
      timers.push({ id, callback, delay, cleared: false });
      return id;
    },
    clearTimeout(id) {
      const timer = timers.find(candidate => candidate.id === id);
      if (timer) timer.cleared = true;
    },
    addEventListener(name, callback) {
      listeners.set(name, callback);
    },
  };
  class AbortControllerFixture {
    constructor() {
      this.signal = {};
      this.aborted = false;
    }
    abort() { this.aborted = true; }
  }
  const fetch = async () => {
    if (reject) throw reject;
    return response ?? {
      status: 200,
      ok: true,
      headers: makeHeaders({ date: fixture.source.serverDate }),
      async json() { return fixture.payload; },
    };
  };
  const context = {
    window,
    fetch,
    AbortController: AbortControllerFixture,
    Date, Math, Map, JSON, Number, String, Array, Object, Event, console,
  };
  vm.runInNewContext(generatedStatsScript(), context);
  for (let count = 0; count < 8; count += 1) {
    await new Promise(resolve => setImmediate(resolve));
  }
  return { messages, timers, window, listeners };
}

test('captured streakStats payload becomes one native-ready snapshot', async () => {
  const { messages, timers } = await runStats();
  const document = messages.find(
    message => message.type === 'stationhead-stats-document');
  const ready = messages.find(
    message => message.type === 'stationhead-auth-ready');
  const result = messages.find(
    message => message.type === 'stationhead-play-stats');
  assert.ok(document?.document_generation > 0);
  assert.equal(ready?.auth_generation, 7);
  assert.ok(result);
  assert.equal(result.source, 'authenticated-api-normalized-v4');
  assert.equal(result.request_id, 1);
  assert.equal(result.document_generation, document.document_generation);
  assert.equal(result.auth_generation, 7);
  assert.equal(result.timezone, 'Etc/UTC');
  assert.equal(result.data.chart_data.length, fixture.payload.chart_data.length);
  assert.deepEqual(result.data.chart_data.at(-1), fixture.payload.chart_data.at(-1));
  assert.equal(timers.filter(timer => !timer.cleared).length, 0);
});

test('positive nested series wins and duplicate timestamps are reduced', async () => {
  const seconds = Math.floor(Date.now() / 86_400_000) * 86_400;
  const { messages } = await runStats({
    response: {
      status: 200,
      ok: true,
      headers: makeHeaders({ date: new Date().toUTCString() }),
      async json() {
        return {
          chart_data: [{ ts: seconds, val: 0 }],
          data: {
            history: [
              { timestamp: seconds, plays: '1,234' },
              { timestamp: seconds, plays: '1,235' },
              { timestamp: seconds + 86_400, plays: 88 },
            ],
          },
          timezone: 'Etc/UTC',
        };
      },
    },
  });
  const result = messages.find(
    message => message.type === 'stationhead-play-stats');
  assert.deepEqual(result.data.chart_data, [
    { ts: seconds * 1000, val: 1235 },
    { ts: (seconds + 86_400) * 1000, val: 88 },
  ]);
});

test('network, 5xx, invalid payload, and timeout paths request a 30-second retry', async () => {
  const network = await runStats({ reject: new Error('offline') });
  assert.ok(network.messages.some(message =>
    message.type === 'stationhead-play-stats-error' &&
    message.error === 'network-or-json'));
  assert.equal(network.timers.at(-1).delay, 30_000);

  const server = await runStats({
    response: {
      status: 503,
      ok: false,
      headers: makeHeaders(),
      async json() { return {}; },
    },
  });
  assert.ok(server.messages.some(message =>
    message.type === 'stationhead-play-stats-error' &&
    message.error === 'http-503'));
  assert.equal(server.timers.at(-1).delay, 30_000);

  const invalid = await runStats({
    response: {
      status: 200,
      ok: true,
      headers: makeHeaders(),
      async json() { return { chart_data: [{ ts: 'bad', val: 'bad' }] }; },
    },
  });
  assert.ok(invalid.messages.some(message =>
    message.type === 'stationhead-play-stats-error' &&
    message.error === 'invalid-payload'));
  assert.equal(invalid.timers.at(-1).delay, 30_000);
  assert.match(policy, /20 \* 1000/);
  assert.match(policy, /scheduleRetry\('request-timeout'\)/);
});

test('401 and 403 clear the account candidate and publish request identity', async () => {
  for (const status of [401, 403]) {
    const run = await runStats({
      response: {
        status,
        ok: false,
        headers: makeHeaders(),
        async json() { return {}; },
      },
    });
    const rejected = run.messages.find(message =>
      message.type === 'stationhead-play-stats-auth-failed');
    assert.equal(rejected.status, status);
    assert.equal(rejected.request_id, 1);
    assert.ok(rejected.document_generation > 0);
    assert.equal(rejected.auth_generation, 7);
    assert.equal(run.window.__homepanelStationheadAccountAuthHeaders, null);
    assert.equal(
      run.window.__homepanelStationheadRejectedAuthorization,
      'Bearer fixture',
    );
  }
});

test('pagehide aborts the active request and suppresses its late result', async () => {
  let resolveResponse;
  const pendingResponse = new Promise(resolve => { resolveResponse = resolve; });
  const messages = [];
  const listeners = new Map();
  const window = {
    __homepanelStationheadAccountAuthHeaders: { authorization: 'Bearer fixture' },
    __homepanelStationheadAccountAuthGeneration: 7,
    __homepanelStationheadStatsAuthGeneration: 7,
    chrome: { webview: { postMessage: message => messages.push(message) } },
    setTimeout() { return 1; },
    clearTimeout() {},
    addEventListener(name, callback) { listeners.set(name, callback); },
  };
  class AbortControllerFixture {
    constructor() { this.signal = {}; this.aborted = false; }
    abort() { this.aborted = true; }
  }
  const context = {
    window,
    fetch: () => pendingResponse,
    AbortController: AbortControllerFixture,
    Date, Math, Map, JSON, Number, String, Array, Object, Event, console,
  };
  vm.runInNewContext(generatedStatsScript(), context);
  listeners.get('pagehide')();
  resolveResponse({
    status: 200,
    ok: true,
    headers: makeHeaders({ date: fixture.source.serverDate }),
    async json() { return fixture.payload; },
  });
  for (let count = 0; count < 8; count += 1) {
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.equal(
    messages.some(message => message.type === 'stationhead-play-stats'),
    false,
  );
  assert.equal(window.__homepanelStationheadStatsDocumentActive, false);
});

test('a duplicate poll cannot replace the active request id', async () => {
  let resolveResponse;
  const pendingResponse = new Promise(resolve => { resolveResponse = resolve; });
  const messages = [];
  const window = {
    __homepanelStationheadAccountAuthHeaders: { authorization: 'Bearer fixture' },
    __homepanelStationheadAccountAuthGeneration: 7,
    __homepanelStationheadStatsAuthGeneration: 7,
    chrome: { webview: { postMessage: message => messages.push(message) } },
    setTimeout() { return 1; }, clearTimeout() {}, addEventListener() {},
  };
  class AbortControllerFixture {
    constructor() { this.signal = {}; }
    abort() {}
  }
  const context = {
    window,
    fetch: () => pendingResponse,
    AbortController: AbortControllerFixture,
    Date, Math, Map, JSON, Number, String, Array, Object, Event, console,
  };
  vm.runInNewContext(generatedStatsScript(), context);
  const activeRequestId = window.__homepanelStationheadPlayStatsLatestRequestId;
  vm.runInNewContext(generatedStatsScript(), context);
  assert.equal(window.__homepanelStationheadPlayStatsLatestRequestId, activeRequestId);
  resolveResponse({
    status: 200,
    ok: true,
    headers: makeHeaders({ date: fixture.source.serverDate }),
    async json() { return fixture.payload; },
  });
  for (let count = 0; count < 8; count += 1) {
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.ok(messages.some(message => message.type === 'stationhead-play-stats'));
  assert.equal(window.__homepanelStationheadPlayStatsInFlight, false);
});

test('the generated policy does not persist or log credentials', () => {
  assert.match(policy, /window\.addEventListener\('pagehide'/);
  assert.doesNotMatch(policy, /localStorage|sessionStorage/);
  assert.doesNotMatch(policy, /console\.log\(.*authorization/i);
});
