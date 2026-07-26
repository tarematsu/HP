import { sanitizeText } from './observability-status-publisher.mjs';

export const NATIVE_RELEASE_WORKFLOW = 'native-windows-build.yml';
export const NATIVE_RELEASE_RUN_LOOKBACK = 20;
export const MAX_NATIVE_RELEASE_SUMMARY_CHARS = 3_000;

const NATIVE_RELEASE_EXACT_PATHS = new Set([
  'THIRD_PARTY_NOTICES.md',
  '.github/actions/cloudflare-context/action.yml',
  '.github/scripts/resolve-cloudflare-account.mjs',
  '.github/scripts/resolve-cloudflare-config.mjs',
  '.github/workflows/native-windows-build.yml',
]);

const FAILURE_CONCLUSIONS = new Set([
  'action_required',
  'cancelled',
  'failure',
  'startup_failure',
  'stale',
  'timed_out',
]);

function compact(value, maximum = 500) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length <= maximum) return text;
  return `${text.slice(0, Math.max(0, maximum - 1))}…`;
}

function normalizedResult(value) {
  return String(value || '').trim().toLowerCase() || 'unknown';
}

function cleanLogLine(line) {
  return String(line || '')
    .replace(/^\ufeff/, '')
    .replace(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z\s+/, '')
    .replace(/\u001b\[[0-9;]*m/g, '')
    .replace(/^##\[(?:group|endgroup|command|debug)\]/i, '')
    .trim();
}

function jobName(job) {
  return String(job?.name || '').trim();
}

function findJob(jobs) {
  return (Array.isArray(jobs) ? jobs : []).find((job) => /^build$/i.test(jobName(job)))
    || (Array.isArray(jobs) ? jobs[0] : null)
    || null;
}

function findStep(job, patterns) {
  const list = Array.isArray(patterns) ? patterns : [patterns];
  return (Array.isArray(job?.steps) ? job.steps : []).find((step) => (
    list.some((pattern) => pattern.test(String(step?.name || '').trim()))
  )) || null;
}

function stage(job, patterns) {
  const step = findStep(job, patterns);
  if (!step) return { result: 'unknown', evidence: 'Step was not present in the selected run.' };
  return {
    result: normalizedResult(step.conclusion || step.status),
    evidence: String(step.name || 'workflow step'),
  };
}

function runLink(run) {
  if (!run) return 'none';
  const label = Number.isFinite(Number(run.run_number)) ? `#${run.run_number}` : `run ${run.id || 'unknown'}`;
  return run.html_url ? `[${label}](${run.html_url})` : label;
}

function shortSha(value) {
  return String(value || 'unknown').slice(0, 12);
}

function completedAt(run) {
  return run?.updated_at || run?.created_at || 'unknown';
}

function commitTitle(commit) {
  return compact(String(commit?.commit?.message || '').split(/\r?\n/, 1)[0] || 'unknown', 160);
}

function tableCell(value) {
  return compact(sanitizeText(value), 500).replaceAll('|', '\\|') || '-';
}

function releaseArtifact(artifacts, run) {
  const artifact = (Array.isArray(artifacts) ? artifacts : [])
    .find((entry) => entry?.name === 'homepanel-native-windows');
  if (artifact) {
    return {
      result: artifact.expired ? 'expired' : 'success',
      evidence: artifact.expired
        ? 'homepanel-native-windows artifact expired after retention.'
        : 'homepanel-native-windows artifact is available.',
    };
  }
  if (!run || normalizedResult(run.status) !== 'completed') {
    return { result: 'pending', evidence: 'Release artifact is not available yet.' };
  }
  return { result: 'missing', evidence: 'homepanel-native-windows artifact was not found.' };
}

export function nativeReleaseRequired(files) {
  return (Array.isArray(files) ? files : []).some((entry) => {
    const path = String(typeof entry === 'string' ? entry : entry?.filename || '').trim();
    return path.startsWith('hp/native/') || NATIVE_RELEASE_EXACT_PATHS.has(path);
  });
}

export function parseNativeReleaseLog(logText) {
  const lines = String(logText || '').split(/\r?\n/).map(cleanLogLine);
  const text = lines.join('\n');
  const version = text.match(/HOMEPANEL_RELEASE_VERSION=(\d{10})/i)?.[1] || '';
  let rollout = 'unknown';
  if (/Update rollout triggered; devices will be commanded on their next sync\./i.test(text)) {
    rollout = 'immediate';
  } else if (/HOMEPANEL_WORKER_URL not configured; devices will pick the release up via the 5-minute update_check poll\./i.test(text)) {
    rollout = 'scheduled-poll';
  } else if (/Immediate rollout trigger failed .*5-minute update_check poll will still roll the release out\./i.test(text)) {
    rollout = 'poll-fallback';
  }
  return { version, rollout };
}

function releaseError(logText) {
  const lines = String(logText || '').split(/\r?\n/).map(cleanLogLine).filter(Boolean);
  const preferred = lines.filter((line) => (
    /##\[error\]|::error|\b(?:error|failed|failure|timed out|timeout|exit code)\b/i.test(line)
    && !/^Error: GitHub /i.test(line)
  ));
  const selected = (preferred.length ? preferred : lines.slice(-6))
    .map((line) => line.replace(/^##\[error\]/i, '').replace(/^::error(?: title=[^:]*)?::/i, '').trim())
    .filter(Boolean);
  return compact(sanitizeText([...new Set(selected)].slice(-3).join(' | ')), 700);
}

export function summarizeNativeRelease({
  mainCommit = {},
  currentRun = null,
  activeRun = null,
  run = null,
  jobs = [],
  artifacts = [],
  logText = '',
} = {}) {
  const mainSha = String(mainCommit?.sha || 'unknown');
  const required = nativeReleaseRequired(mainCommit?.files);
  const selectedRun = run || (required ? currentRun : activeRun) || null;
  const job = findJob(jobs);
  const workflow = {
    result: selectedRun
      ? normalizedResult(selectedRun.conclusion || selectedRun.status)
      : required ? 'pending' : 'unknown',
    evidence: selectedRun ? runLink(selectedRun) : 'No matching main-branch release run was found.',
  };
  const build = stage(job, [/Build native project with warnings as errors/i]);
  const packageStage = stage(job, [/Package native release/i]);
  const publish = stage(job, [/Upload update assets to R2/i]);
  const rolloutStep = stage(job, [/Trigger immediate update rollout/i]);
  const markers = parseNativeReleaseLog(logText);
  const artifact = releaseArtifact(artifacts, selectedRun);

  let verdict = 'unknown';
  if (!required) {
    verdict = activeRun && normalizedResult(activeRun.conclusion) === 'success'
      ? 'not required; active release remains published'
      : 'not required';
  } else if (!currentRun || normalizedResult(currentRun.status) !== 'completed') {
    verdict = 'pending';
  } else if (FAILURE_CONCLUSIONS.has(normalizedResult(currentRun.conclusion))) {
    verdict = 'failed';
  } else if (publish.result === 'success') {
    verdict = 'released';
  } else {
    verdict = 'failed';
  }

  let rolloutEvidence = rolloutStep.evidence;
  if (rolloutStep.result === 'success') {
    if (markers.rollout === 'immediate') rolloutEvidence = 'Immediate update command accepted; devices update on next sync.';
    else if (markers.rollout === 'scheduled-poll') rolloutEvidence = 'Immediate endpoint was not configured; 5-minute update_check polling remains active.';
    else if (markers.rollout === 'poll-fallback') rolloutEvidence = 'Immediate trigger failed; 5-minute update_check polling remains active.';
  }

  return {
    main: {
      sha: mainSha,
      url: mainCommit?.html_url || '',
      title: commitTitle(mainCommit),
    },
    required,
    verdict,
    run: selectedRun,
    activeRun,
    version: markers.version,
    error: workflow.result === 'success' ? '' : releaseError(logText),
    stages: {
      workflow,
      build,
      package: packageStage,
      publish,
      rollout: { ...rolloutStep, evidence: rolloutEvidence },
      artifact,
    },
  };
}

async function fetchJobLog(repository, token, jobId) {
  if (!repository || !token || !jobId) return '';
  const response = await fetch(`https://api.github.com/repos/${repository}/actions/jobs/${jobId}/logs`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'User-Agent': 'github-release-status',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    redirect: 'follow',
  });
  if (!response.ok) return '';
  return response.text();
}

export async function collectNativeReleaseStatus(request, {
  repository = process.env.GITHUB_REPOSITORY,
  token = process.env.GITHUB_TOKEN,
} = {}) {
  const [mainCommit, runResponse] = await Promise.all([
    request('GET', '/commits/main'),
    request('GET', `/actions/workflows/${encodeURIComponent(NATIVE_RELEASE_WORKFLOW)}/runs?branch=main&per_page=${NATIVE_RELEASE_RUN_LOOKBACK}`),
  ]);
  const runs = Array.isArray(runResponse?.workflow_runs) ? runResponse.workflow_runs : [];
  const mainSha = String(mainCommit?.sha || '');
  const currentRun = runs.find((entry) => String(entry?.head_sha || '') === mainSha) || null;
  const activeRun = runs.find((entry) => (
    normalizedResult(entry?.status) === 'completed'
    && normalizedResult(entry?.conclusion) === 'success'
  )) || null;
  const required = nativeReleaseRequired(mainCommit?.files);
  const selectedRun = required ? currentRun : activeRun;
  if (!selectedRun) {
    return summarizeNativeRelease({ mainCommit, currentRun, activeRun });
  }

  const [jobResponse, artifactResponse] = await Promise.all([
    request('GET', `/actions/runs/${selectedRun.id}/jobs?per_page=100`),
    request('GET', `/actions/runs/${selectedRun.id}/artifacts?per_page=100`),
  ]);
  const jobs = Array.isArray(jobResponse?.jobs) ? jobResponse.jobs : [];
  const artifacts = Array.isArray(artifactResponse?.artifacts) ? artifactResponse.artifacts : [];
  const job = findJob(jobs);
  const logText = await fetchJobLog(repository, token, job?.id);
  return summarizeNativeRelease({
    mainCommit,
    currentRun,
    activeRun,
    run: selectedRun,
    jobs,
    artifacts,
    logText,
  });
}

export function renderNativeReleaseSummary(status, { generatedAt = new Date().toISOString() } = {}) {
  const release = status || summarizeNativeRelease();
  const mainLabel = release.main?.url
    ? `[\`${shortSha(release.main.sha)}\`](${release.main.url})`
    : `\`${shortSha(release.main?.sha)}\``;
  const selectedRun = release.run;
  const activeRun = release.activeRun;
  const active = activeRun
    ? `\`${shortSha(activeRun.head_sha)}\` · ${runLink(activeRun)} · ${completedAt(activeRun)}`
    : 'unknown';
  const rows = Object.entries(release.stages || {}).map(([name, value]) => {
    const labels = {
      workflow: 'Native Windows workflow',
      build: 'Build',
      package: 'Package',
      publish: 'R2 update assets',
      rollout: 'Device rollout',
      artifact: 'Download artifact',
    };
    return `| ${labels[name] || name} | **${tableCell(value?.result)}** | ${tableCell(value?.evidence)} |`;
  });
  const selected = selectedRun
    ? `\`${shortSha(selectedRun.head_sha)}\` · ${runLink(selectedRun)} · ${completedAt(selectedRun)}`
    : 'none';
  const versionLine = release.version ? `\n- **Build version:** \`${release.version}\`` : '';
  const errorLine = release.error ? `\n- **Release error:** ${tableCell(release.error)}` : '';

  return `<a id="homepanel-release-information" name="homepanel-release-information"></a>
#### HomePanel native release information

- **Generated:** ${generatedAt}
- **Current main:** ${mainLabel} — ${tableCell(release.main?.title)}
- **Native release required by current merge:** ${release.required ? 'yes' : 'no'}
- **Verdict:** **${tableCell(release.verdict)}**
- **Selected release run:** ${selected}
- **Active successful native release:** ${active}${versionLine}${errorLine}

| Stage | Result | Evidence |
|---|---|---|
${rows.join('\n')}`;
}
