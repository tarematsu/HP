import { appendFile } from 'node:fs/promises';

const accountId = String(process.env.CLOUDFLARE_ACCOUNT_ID || '').trim();
const apiToken = String(process.env.CLOUDFLARE_API_TOKEN || '').trim();
const outputPath = String(process.env.GITHUB_OUTPUT || '').trim();
const projectName = String(process.argv[2] || '').trim();

if (!accountId) throw new Error('CLOUDFLARE_ACCOUNT_ID is required');
if (!apiToken) throw new Error('CLOUDFLARE_API_TOKEN is required');
if (!projectName) throw new Error('Pages project name is required');

const response = await fetch(
  `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/pages/projects/${encodeURIComponent(projectName)}`,
  {
    headers: {
      authorization: `Bearer ${apiToken}`,
      'content-type': 'application/json',
    },
  },
);
const payload = await response.json().catch(() => null);
if (!response.ok || payload?.success !== true) {
  const message = payload?.errors?.[0]?.message || `Cloudflare API returned HTTP ${response.status}`;
  throw new Error(`Could not read Pages project ${projectName}: ${message}`);
}

const productionBranch = String(payload?.result?.production_branch || '').trim();
if (!productionBranch) {
  throw new Error(`Pages project ${projectName} does not define a production branch`);
}

if (outputPath) {
  await appendFile(outputPath, `production_branch=${productionBranch}\n`, 'utf8');
} else {
  process.stdout.write(`${productionBranch}\n`);
}
