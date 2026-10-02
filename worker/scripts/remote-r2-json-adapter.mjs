import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function createWranglerRemoteR2({ bucket, cwd, wranglerScript, execute = execFileSync }) {
  if (!bucket || !cwd || !wranglerScript) throw new Error('Remote R2 configuration missing');
  return {
    async get(key) {
      const directory = mkdtempSync(join(tmpdir(),'remote-r2-read-'));
      const file = join(directory,'object.json');
      try {
        try {
          execute(process.execPath,[wranglerScript,'r2','object','get',`${bucket}/${key}`,'--remote','--file',file],{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:60_000});
        } catch (error) {
          if (/specified key does not exist|specified object does not exist|object does not exist/i.test(`${error.stdout || ''} ${error.stderr || ''}`)) return null;
          throw new Error('Remote R2 read failed');
        }
        const body = readFileSync(file,'utf8');
        return { json:async()=>JSON.parse(body) };
      } finally { rmSync(directory,{recursive:true,force:true}); }
    },
    async put(key,body) {
      const directory = mkdtempSync(join(tmpdir(),'remote-r2-write-'));
      const file = join(directory,'object.json');
      try {
        writeFileSync(file,body,'utf8');
        try {
          execute(process.execPath,[wranglerScript,'r2','object','put',`${bucket}/${key}`,'--remote','--file',file,'--content-type','application/json; charset=utf-8'],{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:60_000});
        } catch { throw new Error('Remote R2 write failed'); }
      } finally { rmSync(directory,{recursive:true,force:true}); }
    },
  };
}
