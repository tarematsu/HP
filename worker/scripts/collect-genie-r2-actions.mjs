import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { collectGenieSnapshot } from '../src/genie-catalog-snapshot.js';

export async function enqueueGeniePublication(config, api, now) {
  const name = config.queues?.consumers?.[0]?.queue;
  if (!name) throw new Error('Regional publication queue missing');
  const queues = await api('/queues');
  const queue = queues.find(row => row.queue_name === name);
  if (!queue?.queue_id) throw new Error('Regional publication queue not found');
  await api(`/queues/${queue.queue_id}/messages`, { body:{ message_type:'regional-music-publish', scheduled_at:now }, content_type:'json' });
}

async function main() {
  const root = resolve(import.meta.dirname, '..');
  const config = JSON.parse(readFileSync(join(root,'wrangler.regional-music.jsonc'),'utf8'));
  const bucket = config.r2_buckets.find(row => row.binding === 'PAGES_RESPONSE_R2')?.bucket_name;
  if (!bucket) throw new Error('Configured snapshot bucket missing');
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!account || !token) throw new Error('Cloudflare account context missing');
  const wrangler = join(root,'node_modules/wrangler/bin/wrangler.js');
  function object(key, value) {
    const directory = mkdtempSync(join(root,'.genie-r2-'));
    const file = join(directory,'object.json');
    try {
      if (value !== undefined) writeFileSync(file,JSON.stringify(value));
      try {
        execFileSync(process.execPath,[wrangler,'r2','object',value === undefined ? 'get' : 'put',`${bucket}/${key}`,'--remote','--file',file,...(value === undefined ? [] : ['--content-type','application/json'])],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:60_000});
      } catch (error) {
        if (value === undefined && /specified key does not exist|specified object does not exist|object does not exist/i.test(`${error.stdout || ''} ${error.stderr || ''}`)) return null;
        throw new Error(`Genie R2 ${value === undefined ? 'read' : 'write'} failed`);
      }
      return value === undefined ? JSON.parse(readFileSync(file,'utf8')) : undefined;
    } finally { rmSync(directory,{recursive:true,force:true}); }
  }
  const fetchHtml = async (url, data) => {
    const response = await fetch(url,{...(data ? {method:'POST',body:data} : {}), headers:{accept:'text/html',...(data ? {'content-type':'application/x-www-form-urlencoded'} : {}),'user-agent':'Mozilla/5.0 compatible; skrzk-pages-collector/1.0'},signal:AbortSignal.timeout(30_000)});
    if (!response.ok) throw new Error(`Genie HTTP ${response.status}`);
    return response.text();
  };
  const snapshot = await collectGenieSnapshot({fetchHtml,load:key=>object(key),save:(key,value)=>object(key,value)});
  const api = async (path, body) => {
    const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}${path}`,{method:body ? 'POST' : 'GET',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},...(body ? {body:JSON.stringify(body)} : {}),signal:AbortSignal.timeout(30_000)});
    const result = await response.json();
    if (!response.ok || result.success !== true) throw new Error(`Publication queue API failed: HTTP ${response.status}`);
    return result.result;
  };
  await enqueueGeniePublication(config,api,snapshot.updated_at);
  console.log(JSON.stringify({event:'genie_r2_complete',day:snapshot.day,...snapshot.state.entity_counts,status:snapshot.state.status,collection_d1_writes:0,publication_messages:1}));
  if (snapshot.state.status !== 'ok') process.exitCode = 1;
}
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main().catch(error=>{console.error(error.message);process.exitCode=1;});
