import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function createWranglerRemoteR2({ bucket, cwd, wranglerScript, execute = execFileSync }) {
  if (!bucket || !cwd || !wranglerScript) throw new Error('Remote R2 configuration missing');
  // Wrangler interpolates the key into an HTTP URL. Encode every segment so
  // literal percent escapes, query characters and fragments survive one URL decode.
  const objectPath = key => `${bucket}/${String(key).split('/').map(encodeURIComponent).join('/')}`;
  return {
    async get(key) {
      const owner = this;
      const directory = mkdtempSync(join(tmpdir(),'remote-r2-read-'));
      const file = join(directory,'object.json');
      try {
        try {
          execute(process.execPath,[wranglerScript,'r2','object','get',objectPath(key),'--remote','--file',file],{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:60_000});
        } catch (error) {
          if (/specified key does not exist|specified object does not exist|object does not exist/i.test(`${error.stdout || ''} ${error.stderr || ''}`)) return null;
          throw new Error('Remote R2 read failed');
        }
        const body = readFileSync(file,'utf8');
        return { body: new Response(body).body, text: async () => body, json:async()=> {
          const payload = JSON.parse(body);
          if (payload?.format !== 'raw-response-reference-v1') return payload;
          if (!/^pages-response\/raw-body-v1\/[a-f0-9]{64}\.json$/.test(payload.body_key || '')) {
            throw new Error('Invalid raw R2 response reference');
          }
          const raw = await owner.get(payload.body_key);
          if (!raw) throw new Error('Raw R2 response body missing');
          // Actions consumers retain their existing envelope interface.
          return { ...payload, body: await raw.text() };
        } };
      } finally { rmSync(directory,{recursive:true,force:true}); }
    },
    async put(key,body,options = {}) {
      const metadata = options.customMetadata;
      // Wrangler cannot preserve custom metadata. Publish an immutable raw
      // body plus a small manifest instead of forcing HTTP to decode an envelope.
      if (metadata?.format === 'raw-response-v1') {
        const rawBody = String(body);
        const bodyKey = `pages-response/raw-body-v1/${createHash('sha256').update(rawBody).digest('hex')}.json`;
        await this.put(bodyKey, rawBody);
        body = JSON.stringify({
          version: 1,
          format: 'raw-response-reference-v1',
          body_key: bodyKey,
          status: Number(metadata.status) || 200,
          headers: JSON.parse(metadata.headers_json || '{}'),
          updated_at: Number(metadata.updated_at),
          cadence_seconds: Number(metadata.cadence_seconds) || 0,
        });
      }
      const directory = mkdtempSync(join(tmpdir(),'remote-r2-write-'));
      const file = join(directory,'object.json');
      try {
        writeFileSync(file,body,'utf8');
        try {
          execute(process.execPath,[wranglerScript,'r2','object','put',objectPath(key),'--remote','--file',file,'--content-type','application/json; charset=utf-8'],{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:60_000});
        } catch { throw new Error('Remote R2 write failed'); }
      } finally { rmSync(directory,{recursive:true,force:true}); }
    },
  };
}
