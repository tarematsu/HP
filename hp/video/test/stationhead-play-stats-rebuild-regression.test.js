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
  const match = source.match(
    /script << LR"JS\(([\s\S]*?)\)JS"\s*<< channelId << LR"JS\(([\s\S]*?)\)JS";/,
  );
  assert.ok(match, 'stats generator raw-string boundary is intact');
  return `${match[1]}${channelId}${match[2]}`;
}

function makeHeaders(values = {}) {
  const entries = Object.entries(values).map(([key, value]) => [key.toLowerCase(), value]);
  return {
    get(name) {
      const found = entries.find(([key]) => key === String(name).toLowerCase());
      return found ? found[1] : null;
    },
  };
}

async function runStats({
  response,
  reject,
  auth = 'Bearer fixture',
} = {}) {
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
    Date,
    Math,
    Map,
    JSON,
    Number,
    String,
    Array,
    Object,
    Event,
    console,
  };
  vm.runInNewContext(generatedStatsScript(), context);
  for (let count = 0; count < 8; count += 1) {
    await new Promise(resolve => setImmediate(resolve));
  }
  return { messages, timers, window, listeners };
}

test('captured streakStats payload is normalized and published with request identity', async () => {
  const { messages, timers } = await runStats();
  const result = messages.find(message => message.type === 'stationhead-play-stats');
  assert.ok(result);
  assert.equal(result.source, 'authenticated-api-normalized-v3');
  assert.equal(result.request_id, 1);
  assert.ok(result.document_generation > 0);
  assert.equal(result.timezone, 'Etc/UTC');
  assert.equal(result.data.chart_data.length, fixture.payload.chart_data.length);
  assert.deepEqual(
    result.data.chart_data.at(-1),
    fixture.payload.chart_data.at(-1),
  );
  assert.equal(timers.filter(timer => !timer.cleared).length, 0);
  assert.equal(result.auth_generation, 7);
});

test('positive nested series wins over a zero placeholder and duplicate dates are reduced', async () => {
  const seconds = Math.floor(fixture.payload.chart_data[0].ts / 1000);
  const { messages } = await runStats({
    response: {
      status: 200,
      ok: true,
      headers: makeHeaders({ date: fixture.source.serverDate }),
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
  const result = messages.find(message => message.type === 'stationhead-play-stats');
  assert.deepEqual(result.data.chart_data, [
    { ts: seconds * 1000, val: 1235 },
    { ts: (seconds + 86_400) * 1000, val: 88 },
  ]);
});

test('network, 5xx, and invalid payload failures schedule a native retry at 30 seconds', async () => {
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
});

test('401 and 403 invalidate the account statistics candidate', async () => {
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
    assert.equal(run.window.__homepanelStationheadAccountAuthHeaders, null);
    assert.equal(
      run.window.__homepanelStationheadStatsRejectedAuthorization,
      'Bearer fixture',
    );
  }
});

test('pagehide aborts the active request and stale request results are ignored', async () => {
  let resolveResponse;
  const pendingResponse = new Promise(resolve => { resolveResponse = resolve; });
  const messages = [];
  const listeners = new Map();
  const window = {
    __homepanelStationheadAccountAuthHeaders: { authorization: 'Bearer fixture' },
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

test('a duplicate poll cannot supersede the active request identity', async () => {
  let resolveResponse;
  const pendingResponse = new Promise(resolve => { resolveResponse = resolve; });
  const messages = [];
  const timers = [];
  const window = {
    __homepanelStationheadAccountAuthHeaders: { authorization: 'Bearer fixture' },
    __homepanelStationheadStatsAuthGeneration: 7,
    chrome: { webview: { postMessage: message => messages.push(message) } },
    setTimeout(callback, delay) {
      const id = timers.length + 1;
      timers.push({ id, callback, delay, cleared: false });
      return id;
    },
    clearTimeout(id) {
      const timer = timers.find(candidate => candidate.id === id);
      if (timer) timer.cleared = true;
    },
    addEventListener() {},
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

test('the generated policy uses native identity and bounded timeout without persistence', () => {
  assert.match(policy, /type: 'stationhead-stats-document'/);
  assert.match(policy, /auth_generation: authGeneration/);
  assert.match(policy, /Number\.isSafeInteger\(authGeneration\)/);
  assert.match(policy, /requestTimeoutTimer[\s\S]*20 \* 1000/);
  assert.match(policy, /scheduleRetry\('request-timeout'\)/);
  assert.match(policy, /window\.addEventListener\('pagehide'/);
  assert.doesNotMatch(policy, /localStorage/);
});
