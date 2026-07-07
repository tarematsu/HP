import fs from 'node:fs';

const token = process.env.GITHUB_COMMENT_TOKEN;
const branch = process.env.CIRCLE_BRANCH;
const failureLogLines = 15;
const failureLogCharacters = 4000;

if (!token || !branch || branch === 'main') {
  process.exit(0);
}

const repo = process.env.GITHUB_REPOSITORY;

if (!repo) {
  process.exit(0);
}

async function api(path, options = {}) {
  const response = await fetch(`https://api.github.com${path}`, {
    ...options,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    throw new Error(`${response.status} ${await response.text()}`);
  }
  return response.status === 204 ? null : response.json();
}

const pulls = await api(
  `/repos/${repo}/pulls?state=open&head=${encodeURIComponent(`${repo.split('/')[0]}:${branch}`)}`,
);
if (!pulls.length) {
  process.exit(0);
}

const prNumber = pulls.sort((a, b) => b.number - a.number)[0].number;
const marker = `<!-- circleci-failure:${process.env.CIRCLE_JOB}:${process.env.CIRCLE_SHA1} -->`;
const comments = await api(`/repos/${repo}/issues/${prNumber}/comments?per_page=100`);
if (comments.some((comment) => comment.body.includes(marker))) {
  process.exit(0);
}

let logText = fs.existsSync('circleci-cloud.log')
  ? fs.readFileSync('circleci-cloud.log', 'utf8').split(/\r?\n/).slice(-failureLogLines).join('\n')
  : 'The dedicated Worker log was not created. Open the CircleCI job for full output.';
logText = logText
  .replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, '')
  .replaceAll(token, '***');
if (logText.length > failureLogCharacters) {
  logText = logText.slice(-failureLogCharacters);
}

const jobUrl = process.env.CIRCLE_BUILD_URL || 'Unavailable';
const body = [
  marker,
  '## CircleCI Worker exhaustive validation failed',
  '',
  `- **Commit:** \`${process.env.CIRCLE_SHA1}\``,
  `- **Branch:** \`${branch}\``,
  `- **Job:** [${process.env.CIRCLE_JOB}](${jobUrl})`,
  '',
  '<details><summary>Worker failure log tail</summary>',
  '',
  '```text',
  logText,
  '```',
  '',
  '</details>',
].join('\n');

await api(`/repos/${repo}/issues/${prNumber}/comments`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ body }),
});
