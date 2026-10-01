import { pathToFileURL } from 'node:url';

export function deploymentState(runs, sha) {
  const run = runs.filter(run => run.head_sha === sha && run.head_branch === 'main'
    && run.path === '.github/workflows/deploy-split-pipeline.yml' && run.event === 'push')
    .sort((a,b) => b.id - a.id)[0];
  if (!run || run.status !== 'completed') return 'waiting';
  if (run.conclusion !== 'success') throw new Error(`Production deployment ${run.id} ended with ${run.conclusion}`);
  return 'ready';
}

export async function waitForProductionDeployment({ repository, sha, token, fetchImpl=fetch, pause=ms=>new Promise(resolve=>setTimeout(resolve,ms)), now=Date.now }) {
  if (repository !== 'tarematsu/HP' || !/^[a-f0-9]{40}$/.test(sha || '')) throw new Error('Invalid production repository or commit');
  const deadline = now() + 15 * 60_000;
  while (now() < deadline) {
    const response = await fetchImpl(`https://api.github.com/repos/${repository}/actions/workflows/deploy-split-pipeline.yml/runs?head_sha=${sha}&per_page=10`, {
      headers: { accept:'application/vnd.github+json', ...(token ? { authorization:`Bearer ${token}` } : {}) },
    });
    if (!response.ok) throw new Error(`Deployment status request failed: HTTP ${response.status}`);
    if (deploymentState((await response.json()).workflow_runs || [],sha) === 'ready') {
      console.log('Production deployment succeeded; regional recollection can start.');
      return;
    }
    await pause(15_000);
  }
  throw new Error('Production deployment did not finish before the recollection deadline');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await waitForProductionDeployment({ repository:process.env.GITHUB_REPOSITORY, sha:process.env.GITHUB_SHA, token:process.env.GH_TOKEN });
}
