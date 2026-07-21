import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const outputDirectory = path.resolve('.cloudflare-build-diagnostics');
let accountId = String(process.env.CLOUDFLARE_ACCOUNT_ID || process.env.CF_ACCOUNT_ID || '').trim();
const apiToken = String(
  process.env.CLOUDFLARE_BUILDS_API_TOKEN ||
  process.env.CLOUDFLARE_API_TOKEN ||
  process.env.CF_API_TOKEN ||
  ''
).trim();
let workerName = String(process.env.CLOUDFLARE_WORKER_NAME || process.env.WORKER_NAME || '').trim();
const targetSha = String(process.env.TARGET_SHA || process.env.GITHUB_SHA || '').trim().toLowerCase();
const targetBranch = String(process.env.TARGET_BRANCH || process.env.GITHUB_REF_NAME || '').trim();
const timeoutMinutes = Math.max(5, Math.min(30, Number(process.env.CLOUDFLARE_BUILD_TIMEOUT_MINUTES || 22)));
const pollMilliseconds = Math.max(10_000, Number(process.env.CLOUDFLARE_BUILD_POLL_MS || 20_000));
const apiRoot = 'https://api.cloudflare.com/client/v4';
const autoNameNeedle = 'video';

await mkdir(outputDirectory, { recursive: true });

function mask(value) {
  let text = String(value ?? '');
  if (apiToken) text = text.replaceAll(apiToken, '[REDACTED_TOKEN]');
  return text
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+/gi, 'Bearer [REDACTED]')
    .replace(/\b(authorization|api[_-]?key|token|secret|password)\b(\s*[:=]\s*)([^\s,;]+)/gi, '$1$2[REDACTED]')
    .replace(/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, '[REDACTED_GITHUB_TOKEN]');
}

async function save(name, value) {
  await writeFile(path.join(outputDirectory, name), mask(value), 'utf8');
}

async function summary(lines) {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (file) await appendFile(file, `${lines.join('\n')}\n`, 'utf8');
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function shaMatches(candidate) {
  const value = String(candidate || '').trim().toLowerCase();
  return Boolean(value) && (value === targetSha || value.startsWith(targetSha) || targetSha.startsWith(value));
}

async function skip(reason) {
  const result = {
    ok: true,
    skipped: true,
    worker: workerName || null,
    sha: targetSha || null,
    branch: targetBranch || null,
    reason,
  };
  await save('result.json', `${JSON.stringify(result, null, 2)}\n`);
  await save('build.log', `${reason}\n`);
  await save('comment.md', `<!-- cloudflare-build-diagnostics:${workerName || 'unknown'} -->\n## Cloudflare Worker build diagnostics skipped\n\n${reason}\n`);
  await summary([
    '## Cloudflare build diagnostics skipped',
    `- Worker: \`${workerName || 'unknown'}\``,
    `- Commit: \`${targetSha || 'missing'}\``,
    `- Reason: ${mask(reason)}`,
  ]);
  console.log(mask(reason));
  process.exitCode = 0;
}

async function request(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  let response;
  try {
    response = await fetch(url, {
      headers: { Authorization: `Bearer ${apiToken}`, Accept: 'application/json' },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  const raw = await response.text();
  let payload;
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    throw new Error(`Cloudflare API returned non-JSON (${response.status}): ${mask(raw).slice(0, 500)}`);
  }
  if (!response.ok || payload.success === false) {
    const errors = (payload.errors || []).map((error) => `${error.code || 'error'}: ${error.message || 'unknown error'}`).join('; ');
    throw new Error(`Cloudflare API ${response.status}: ${errors || 'request failed'}`);
  }
  return payload;
}

function rootEndpoint(endpoint) {
  return `${apiRoot}${endpoint}`;
}

function accountEndpoint(endpoint) {
  return `${apiRoot}/accounts/${encodeURIComponent(accountId)}${endpoint}`;
}

async function cloudflareRoot(endpoint) {
  return request(rootEndpoint(endpoint));
}

async function cloudflare(endpoint) {
  return request(accountEndpoint(endpoint));
}

function selectByNeedle(entries, kind) {
  if (!entries.length) return null;
  if (entries.length === 1) return entries[0];
  const matches = entries.filter((entry) => String(entry.name || entry.id || '').toLowerCase().includes(autoNameNeedle));
  if (matches.length === 1) return matches[0];
  const names = entries.map((entry) => entry.name || entry.id).join(', ');
  const matchNames = matches.map((entry) => entry.name || entry.id).join(', ');
  if (matches.length > 1) throw new Error(`Multiple Cloudflare ${kind}s containing "${autoNameNeedle}" found (${matchNames}). Set the exact ${kind} explicitly.`);
  throw new Error(`Multiple Cloudflare ${kind}s found (${names}), and none contains "${autoNameNeedle}". Set the exact ${kind} explicitly.`);
}

async function resolveAccountId() {
  if (accountId) return accountId;
  const payload = await cloudflareRoot('/accounts?per_page=50');
  const accounts = (payload.result || [])
    .map((entry) => ({ id: String(entry?.id || '').trim(), name: String(entry?.name || '').trim() }))
    .filter((entry) => entry.id);
  const selected = selectByNeedle(accounts, 'account');
  if (!selected?.id) throw new Error('Cloudflare account could not be resolved from API token. Set CLOUDFLARE_ACCOUNT_ID.');
  accountId = selected.id;
  console.log(`Resolved Cloudflare account: ${selected.name || selected.id}`);
  return accountId;
}

async function resolveWorkerName() {
  if (workerName) return workerName;
  const payload = await cloudflare('/workers/scripts');
  const workers = (payload.result || [])
    .map((entry) => ({ id: String(entry?.id || '').trim(), name: String(entry?.id || entry?.name || '').trim(), tag: entry?.tag || null }))
    .filter((entry) => entry.id);
  const selected = selectByNeedle(workers, 'worker');
  if (!selected?.id) throw new Error('Cloudflare Worker could not be resolved from API token. Set CLOUDFLARE_WORKER_NAME.');
  workerName = selected.id;
  console.log(`Resolved Cloudflare Worker: ${workerName}`);
  return workerName;
}

async function workerTag() {
  await resolveWorkerName();
  const payload = await cloudflare('/workers/scripts');
  const worker = (payload.result || []).find((entry) => entry?.id === workerName);
  if (!worker?.tag) throw new Error(`Worker not found in this account: ${workerName}`);
  return worker.tag;
}

function newestMatchingBuild(builds) {
  return [...builds]
    .filter((build) => shaMatches(build?.build_trigger_metadata?.commit_hash))
    .sort((left, right) => Date.parse(right?.created_on || 0) - Date.parse(left?.created_on || 0))[0] || null;
}

async function fetchBuildLogs(buildUuid) {
  const lines = [];
  let cursor = '';
  for (let page = 0; page < 50; page += 1) {
    const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
    const payload = await cloudflare(`/builds/builds/${encodeURIComponent(buildUuid)}/logs${query}`);
    const result = payload.result || {};
    for (const line of result.lines || []) {
      if (Array.isArray(line)) {
        const [timestamp, ...parts] = line;
        const numericTimestamp = Number(timestamp);
        const prefix = Number.isFinite(numericTimestamp)
          ? `[${new Date(numericTimestamp > 10_000_000_000 ? numericTimestamp : numericTimestamp * 1000).toISOString()}] `
          : '';
        lines.push(`${prefix}${parts.map(String).join(' ')}`);
      } else {
        lines.push(String(line));
      }
    }
    const next = String(result.cursor || '');
    if (!result.truncated || !next || next === cursor) break;
    cursor = next;
  }
  return mask(lines.join('\n'));
}

function failureExcerpt(logText, reason) {
  const lines = String(logText || reason || 'No build log was returned.').split(/\r?\n/);
  const selected = [];
  const seen = new Set();

  const addRange = (start, end) => {
    for (let index = Math.max(0, start); index < Math.min(lines.length, end); index += 1) {
      if (seen.has(index)) continue;
      seen.add(index);
      selected.push({ index, line: lines[index] });
    }
  };

  for (let index = 0; index < lines.length; index += 1) {
    if (/\bnot ok\s+\d+\s+-|failureType:|AssertionError|SyntaxError|\bERR_[A-Z_]+\b|\[ERROR\]/.test(lines[index])) {
      addRange(index - 4, index + 34);
    }
  }

  addRange(lines.length - 120, lines.length);
  selected.sort((left, right) => left.index - right.index);
  return selected.map((entry) => entry.line).join('\n').slice(-52_000);
}

function commentBody(build, logText, reason) {
  const outcome = build?.build_outcome || 'unknown';
  const buildUuid = build?.build_uuid || 'not-found';
  const excerpt = failureExcerpt(logText, reason);
  return `<!-- cloudflare-build-diagnostics:${workerName}:${targetSha} -->\n## Cloudflare Worker build diagnostics\n\n- Worker: \`${workerName}\`\n- Commit: \`${targetSha}\`\n- Branch: \`${targetBranch || 'unknown'}\`\n- Build UUID: \`${buildUuid}\`\n- Status: \`${build?.status || 'not-found'}\`\n- Outcome: \`${outcome}\`\n\n### Failure-focused log excerpt\n\n\`\`\`text\n${excerpt}\n\`\`\`\n\nThe complete sanitized log is attached to the GitHub Actions run as \`cloudflare-build-diagnostics\`.\n`;
}

async function fail(code, reason, build = null, logText = '') {
  const result = {
    ok: false,
    worker: workerName,
    sha: targetSha,
    branch: targetBranch,
    reason,
    build_uuid: build?.build_uuid || null,
    status: build?.status || null,
    outcome: build?.build_outcome || null,
  };
  await save('result.json', `${JSON.stringify(result, null, 2)}\n`);
  await save('build.log', `${logText || reason}\n`);
  await save('comment.md', commentBody(build, logText, reason));
  await summary([
    '## Cloudflare build diagnostics failed',
    `- Worker: \`${workerName || 'missing'}\``,
    `- Commit: \`${targetSha || 'missing'}\``,
    `- Reason: ${mask(reason)}`,
  ]);
  console.error(mask(reason));
  process.exitCode = code;
}

if (!apiToken) {
  await skip('CLOUDFLARE_BUILDS_API_TOKEN / CLOUDFLARE_API_TOKEN is not set, so Cloudflare build diagnostics were skipped.');
} else if (!targetSha) {
  await skip('TARGET_SHA / GITHUB_SHA is not set, so Cloudflare build diagnostics were skipped.');
} else {
  try {
    await resolveAccountId();
    await resolveWorkerName();
    console.log(`Watching Cloudflare build for ${workerName} at ${targetSha}`);
    const tag = await workerTag();
    const deadline = Date.now() + timeoutMinutes * 60_000;
    let build = null;

    while (Date.now() < deadline) {
      const payload = await cloudflare(`/builds/workers/${encodeURIComponent(tag)}/builds?per_page=100`);
      build = newestMatchingBuild(payload.result || []);
      if (!build) {
        console.log('Matching build has not appeared yet.');
      } else {
        console.log(`Build ${build.build_uuid}: status=${build.status} outcome=${build.build_outcome || 'pending'}`);
        if (build.status === 'stopped') break;
      }
      await sleep(pollMilliseconds);
    }

    if (!build) {
      await fail(4, `No Cloudflare build appeared for commit ${targetSha} within ${timeoutMinutes} minutes.`);
    } else if (build.status !== 'stopped') {
      await fail(4, `Cloudflare build ${build.build_uuid} did not finish within ${timeoutMinutes} minutes.`, build);
    } else {
      const logText = await fetchBuildLogs(build.build_uuid).catch((error) => `Unable to retrieve build logs: ${mask(error?.message || error)}`);
      await save('build.log', `${logText}\n`);
      const success = build.build_outcome === 'success';
      const result = {
        ok: success,
        worker: workerName,
        sha: targetSha,
        branch: targetBranch,
        build_uuid: build.build_uuid,
        status: build.status,
        outcome: build.build_outcome || null,
        created_on: build.created_on || null,
        stopped_on: build.stopped_on || null,
      };
      await save('result.json', `${JSON.stringify(result, null, 2)}\n`);
      if (success) {
        await summary([
          '## Cloudflare build succeeded',
          `- Worker: \`${workerName}\``,
          `- Commit: \`${targetSha}\``,
          `- Build UUID: \`${build.build_uuid}\``,
        ]);
        console.log('Cloudflare build succeeded.');
      } else {
        await fail(2, `Cloudflare build ended with outcome: ${build.build_outcome || 'unknown'}`, build, logText);
      }
    }
  } catch (error) {
    await fail(3, mask(error?.stack || error?.message || error));
  }
}
