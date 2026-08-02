import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const policy = readFileSync(
  new URL('../../native/src/sh_stats_passive_response_policy_fix.h', import.meta.url),
  'utf8',
);
const navigationPolicy = readFileSync(
  new URL('../../native/src/sh_auth_navigation_policy_fix.h', import.meta.url),
  'utf8',
);
const fixture = JSON.parse(readFileSync(
  new URL('./fixtures/stationhead-streak-stats-2026-08-02.json', import.meta.url),
  'utf8',
));

function passiveScript() {
  const match = policy.match(/script\.append\(LR"JS\(([\s\S]*?)\)JS"\);/);
  assert.ok(match, 'passive response script raw string is intact');
  return match[1];
}

function responseFor(payload, url =
  'https://production1.stationhead.com/me/channel/318/streakStats') {
  return {
    ok: true,
    status: 200,
    url,
    headers: { get: name => name === 'date' ? fixture.source.serverDate : null },
    clone() { return responseFor(payload, url); },
    async json() { return payload; },
  };
}

async function flush() {
  for (let index = 0; index < 8; index += 1) {
    await new Promise(resolve => setImmediate(resolve));
  }
}

function createContext({ fetchImpl, XhrClass } = {}) {
  const messages = [];
  const location = {
    hostname: 'stationhead.com',
    href: 'https://stationhead.com/sakuramankai',
  };
  const window = {
    location,
    chrome: { webview: { postMessage: message => messages.push(
      JSON.parse(JSON.stringify(message)),
    ) } },
    __homepanelStationheadStatsDocumentGeneration: 123456,
    fetch: fetchImpl,
    XMLHttpRequest: XhrClass,
  };
  window.top = window;
  return {
    messages,
    window,
    context: {
      window,
      location,
      URL,
      Date,
      Math,
      Number,
      String,
      Array,
      Object,
      JSON,
      RegExp,
      Promise,
      console,
    },
  };
}

test('the passive observer is the final auth-capture policy layer', () => {
  const sessionAt = navigationPolicy.indexOf(
    '#include "sh_stats_session_policy_fix.h"',
  );
  const passiveAt = navigationPolicy.indexOf(
    '#include "sh_stats_passive_response_policy_fix.h"',
  );
  assert.ok(sessionAt >= 0 && passiveAt > sessionAt);
  assert.match(
    policy,
    /#undef StationheadAuthCaptureScript[\s\S]*StationheadAuthCaptureScriptWithPassiveStats/,
  );
});

test('a successful page fetch publishes native-ready play counts without reading Authorization', async () => {
  const run = createContext({
    fetchImpl: async () => responseFor(fixture.payload),
  });
  vm.runInNewContext(passiveScript(), run.context);
  const response = await run.window.fetch(
    'https://production1.stationhead.com/me/channel/318/streakStats',
  );
  assert.equal(response.status, 200);
  await flush();

  const types = run.messages.map(message => message.type);
  assert.deepEqual(types, [
    'stationhead-stats-document',
    'stationhead-auth-ready',
    'stationhead-play-stats',
  ]);
  const result = run.messages.at(-1);
  assert.equal(result.source, 'page-streak-stats-fetch-v1');
  assert.equal(result.request_id, 1);
  assert.equal(result.document_generation, 123456);
  assert.equal(result.auth_generation, 1);
  assert.equal(result.data.total_streams, fixture.payload.total_streams);
  assert.equal(result.data.chart_data.length, fixture.payload.chart_data.length);
});

test('XHR responses use the same passive snapshot path', async () => {
  class XhrFixture {
    constructor() {
      this.listeners = new Map();
      this.status = 200;
      this.responseType = '';
      this.responseURL =
        'https://production1.stationhead.com/me/channel/318/streakStats';
      this.responseText = JSON.stringify(fixture.payload);
    }
    open(_method, url) { this.openedUrl = url; }
    addEventListener(name, listener) { this.listeners.set(name, listener); }
    getResponseHeader(name) {
      return name === 'date' ? fixture.source.serverDate : null;
    }
    send() { this.listeners.get('load')?.(); }
  }
  const run = createContext({ XhrClass: XhrFixture });
  vm.runInNewContext(passiveScript(), run.context);
  const xhr = new run.window.XMLHttpRequest();
  xhr.open('GET', xhr.responseURL);
  xhr.send();
  await flush();

  const result = run.messages.find(
    message => message.type === 'stationhead-play-stats',
  );
  assert.ok(result);
  assert.equal(result.source, 'page-streak-stats-xhr-v1');
  assert.equal(result.data.chart_data.at(-1).val,
    fixture.payload.chart_data.at(-1).val);
});

test('unrelated and malformed responses are not published', async () => {
  const unrelated = createContext({
    fetchImpl: async () => responseFor(
      fixture.payload,
      'https://production1.stationhead.com/api/currentStation',
    ),
  });
  vm.runInNewContext(passiveScript(), unrelated.context);
  await unrelated.window.fetch(
    'https://production1.stationhead.com/api/currentStation',
  );
  await flush();
  assert.equal(unrelated.messages.length, 0);

  const malformed = createContext({
    fetchImpl: async () => responseFor({ total_streams: 1 }),
  });
  vm.runInNewContext(passiveScript(), malformed.context);
  await malformed.window.fetch(
    'https://production1.stationhead.com/me/channel/318/streakStats',
  );
  await flush();
  assert.equal(malformed.messages.length, 0);
});

test('the observer keeps credentials out of storage and native messages', () => {
  assert.doesNotMatch(policy, /localStorage|sessionStorage/);
  assert.doesNotMatch(policy, /authorization\s*:/i);
  assert.match(policy, /response\.clone\(\)/);
  assert.match(policy, /XMLHttpRequest/);
});
