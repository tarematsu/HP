import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { logSlowPagesRead, runPagesResponseFetch } from '../src/pages-response-fetch-entry.js';

test('slow Pages route diagnostics report only validated model keys and bounded path names', () => {
  const original = console.info;
  const logs = [];
  console.info = (value) => logs.push(JSON.parse(value));
  try {
    assert.equal(logSlowPagesRead('track-history','track-history-do',100,105,true),false);
    assert.equal(logSlowPagesRead('arbitrary-untrusted-key','canonical-r2',100,150),false);
    assert.equal(logSlowPagesRead('track-history','track-history-do',100,120,true),true);
    assert.equal(logSlowPagesRead('track-history','track-history-edge-cache',100,112,true),true);
    assert.deepEqual(logs, [{
      event:'pages_response_slow_read',model_key:'track-history',api:true,
      read_path:'track-history-do',elapsed_ms:20,
    },{
      event:'pages_response_slow_read',model_key:'track-history',api:true,
      read_path:'track-history-edge-cache',elapsed_ms:12,
    }]);
    assert.equal(logs.every(log => !('url' in log) && !('query' in log)),true);
  } finally { console.info = original; }
});

test('a slow cache hit emits route attribution without invoking a costly history DO', async () => {
  const original = console.info;
  const logs = [];
  console.info = (value) => logs.push(JSON.parse(value));
  try {
    let doCalls=0;
    const req = new Request('https://pages-read-model.internal/_internal/pages-response?key=track-history&api=1&source=buddies');
    const env={ PAGES_HISTORY_API_COORDINATOR:{
      idFromName(){ return 'history:buddies'; },
      get(){ return { async fetch(){ doCalls++; return Response.json({ source: 'do' }); } }; },
    } };
    const response=await runPagesResponseFetch(req,env,{responseCache:{
      async match(){ await new Promise(resolve=>setTimeout(resolve,18));return Response.json({ source: 'cache' }); },
    }});
    assert.deepEqual(await response.json(),{ source: 'cache' });
    assert.equal(doCalls,0);
    assert.ok(logs.some(entry => entry.read_path==='track-history-edge-cache' && entry.elapsed_ms>=10));
  } finally { console.info=original; }
});

test('history parser is imported only during a DO request, never the 10ms stateless startup path', () => {
  const source = readFileSync(new URL('../src/pages-history-api-coordinator.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /import\\s+\\{\\s*loadTrackHistoryR2ApiResponse/);
  assert.match(source, /import\\('\.\/pages-track-history-r2-api\.js'\)/);
});
