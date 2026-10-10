import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync,writeFileSync,existsSync } from 'node:fs';
import { createWranglerRemoteR2 } from '../scripts/remote-r2-json-adapter.mjs';
const options={bucket:'test-bucket',cwd:'/tmp',wranglerScript:'/tmp/test-wrangler'};
test('remote R2 adapter reads JSON and writes exact bodies with temporary-file cleanup',async()=>{
  const files=[];
  const r2=createWranglerRemoteR2({...options,execute:(_binary,args)=>{
    const file=args[args.indexOf('--file')+1];files.push(file);
    if(args.includes('get')) writeFileSync(file,'{"version":1}');
    else assert.equal(readFileSync(file,'utf8'),'exact body');
  }});
  const object=await r2.get('test.json');
  assert.deepEqual(await object.json(),{version:1});
  await r2.put('test.json','exact body');
  assert.ok(files.every(file=>!existsSync(file)));
});
test('missing object is distinct from authentication, corruption and write failures',async()=>{
  const missing=createWranglerRemoteR2({...options,execute:()=>{throw {stderr:'The specified key does not exist. [code:10007]'};}});
  assert.equal(await missing.get('absent'),null);
  const denied=createWranglerRemoteR2({...options,execute:()=>{throw {stderr:'Authentication error with private-token'};}});
  await assert.rejects(denied.get('test'),{message:'Remote R2 read failed'});
  await assert.rejects(denied.put('test','body'),{message:'Remote R2 write failed'});
  const corrupt=createWranglerRemoteR2({...options,execute:(_binary,args)=>writeFileSync(args[args.indexOf('--file')+1],'bad json')});
  await assert.rejects((await corrupt.get('test')).json(),SyntaxError);
});

test('Actions bootstrap publication remains readable by the production R2 response reader', async () => {
  const { saveMaterializedR2Response, loadMaterializedR2Response } = await import('../src/pages-response-r2.js');
  const stored = new Map();
  const r2 = createWranglerRemoteR2({ ...options, execute: (_binary, args) => {
    const file = args[args.indexOf('--file') + 1];
    const key = decodeURIComponent(new URL(`https://r2.invalid/objects/${args[4]}`).pathname.slice('/objects/'.length));
    if (args.includes('get')) writeFileSync(file, stored.get(key));
    else stored.set(key, readFileSync(file, 'utf8'));
  } });
  await saveMaterializedR2Response(r2, 'music-service:kkbox', '{"ok":true,"service":"kkbox"}', 200,
    { 'content-type': 'application/json' }, 1000, 86400);
  const response = await loadMaterializedR2Response(r2, 'music-service:kkbox', 1000);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-materialized-at'), '1000');
  assert.deepEqual(await response.json(), { ok: true, service: 'kkbox' });
  const manifest = JSON.parse(stored.get('test-bucket/pages-response/v1/music-service%3Akkbox.json'));
  assert.equal(manifest.format, 'raw-response-reference-v1');
  assert.equal(manifest.body, undefined);
  assert.equal(stored.get(`test-bucket/${manifest.body_key}`), '{"ok":true,"service":"kkbox"}');
});

test('Wrangler HTTP transport preserves literal percent escapes and URL delimiters in R2 keys', async () => {
  const stored = new Map();
  const r2 = createWranglerRemoteR2({ ...options, execute: (_binary, args) => {
    const file = args[args.indexOf('--file') + 1];
    // Cloudflare decodes the URL path once; mirror that protocol boundary.
    const logicalPath = decodeURIComponent(new URL(`https://r2.invalid/objects/${args[4]}`).pathname.slice('/objects/'.length));
    if (args.includes('get')) writeFileSync(file, stored.get(logicalPath));
    else stored.set(logicalPath, readFileSync(file, 'utf8'));
  } });
  for (const key of ['pages-response/v1/music-service%3Akkbox.json', 'names/a+b?x#%.json', '日本語/space name.json']) {
    const body = JSON.stringify({ key });
    await r2.put(key, body);
    assert.equal(stored.get(`test-bucket/${key}`), body);
    assert.equal(await (await r2.get(key)).text(), body);
  }
});
