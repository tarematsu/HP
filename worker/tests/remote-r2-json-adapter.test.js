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
