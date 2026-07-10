import { mkdir, writeFile } from 'node:fs/promises';

await mkdir('out', { recursive: true });
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID || '';
const token = process.env.CLOUDFLARE_API_TOKEN || '';
const targetSha = process.env.TARGET_SHA || '';
const workerName = process.env.WORKER_NAME || '';

async function saveError(error) {
  const message = String(error?.stack || error?.message || error);
  await writeFile('out/error.txt', `${message}\n`, 'utf8');
  throw error;
}

try {
  if (!accountId || !token || !targetSha || !workerName) {
    throw new Error('Cloudflare inventory configuration is missing');
  }
  const apiBase = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}`;
  async function api(path) {
    const response = await fetch(`${apiBase}${path}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    const raw = await response.text();
    let payload;
    try { payload = raw ? JSON.parse(raw) : {}; }
    catch { throw new Error(`Cloudflare API ${response.status} returned invalid JSON`); }
    if (!response.ok || payload.success === false) {
      throw new Error(`Cloudflare API ${response.status}: ${JSON.stringify(payload.errors || [])}`);
    }
    return payload.result;
  }

  const scripts = await api('/workers/scripts');
  const worker = scripts.find((entry) => entry?.id === workerName);
  if (!worker?.tag) throw new Error(`Worker not found: ${workerName}`);

  let build = null;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const builds = await api(`/builds/workers/${encodeURIComponent(worker.tag)}/builds?per_page=100`);
    build = [...builds]
      .filter((entry) => {
        const sha = String(entry?.build_trigger_metadata?.commit_hash || '').toLowerCase();
        return sha && (sha === targetSha || sha.startsWith(targetSha) || targetSha.startsWith(sha));
      })
      .sort((a, b) => Date.parse(b.created_on || 0) - Date.parse(a.created_on || 0))[0] || null;
    if (build?.status === 'stopped') break;
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }
  if (!build) throw new Error(`No Cloudflare build found for ${targetSha}`);
  if (build.status !== 'stopped' || build.build_outcome !== 'success') {
    throw new Error(`Cloudflare build not successful: status=${build.status} outcome=${build.build_outcome}`);
  }

  const lines = [];
  let cursor = '';
  for (let page = 0; page < 50; page += 1) {
    const suffix = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
    const result = await api(`/builds/builds/${encodeURIComponent(build.build_uuid)}/logs${suffix}`);
    for (const line of result.lines || []) {
      lines.push(Array.isArray(line) ? line.slice(1).map(String).join(' ') : String(line));
    }
    const next = String(result.cursor || '');
    if (!result.truncated || !next || next === cursor) break;
    cursor = next;
  }
  const text = lines.join('\n');
  const match = text.match(/SH_REFACTOR_REPORT_BEGIN\s*\n([\s\S]*?)\nSH_REFACTOR_REPORT_END/);
  if (!match) throw new Error('SH inventory marker was not found in Cloudflare logs');
  const report = JSON.parse(match[1].trim());
  await writeFile('out/stationhead-report.json', `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await writeFile('out/build.json', `${JSON.stringify({
    targetSha,
    buildUuid: build.build_uuid,
    pathHits: report.pathHits.length,
    contentHits: report.contentHits.length,
  }, null, 2)}\n`, 'utf8');
  console.log(`Collected ${report.pathHits.length} paths and ${report.contentHits.length} identifier files`);
} catch (error) {
  await saveError(error);
}
