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

function stage(job, patterns, pending = false) {
  const step = findStep(job, patterns);
  if (!step) {
    return pending
      ? { result: 'pending', evidence: 'Step has not completed yet.' }
      : { result: 'unknown', evidence: 'Step was not present in the selected run.' };
  }
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
  return compact(sanitizeText(String(value || '')), 500).replaceAll('|', '\\|') || '-';
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

export function summarizeNativeRelease({
  mainCommit = {},
  currentRun = null,
  activeRun = null,
  run = null,
  jobs = [],
  artifacts = [],
} = {}) {
  const mainSha = String(mainCommit?.sha || 'unknown');
  const required = nativeReleaseRequired(mainCommit?.files);
  const selectedRun = run || (required ? currentRun : activeRun) || null;
  const pending = Boolean(selectedRun && normalizedResult(selectedRun.status) !== 'completed');
  const job = findJob(jobs);
  const workflow = {
    result: selectedRun
      ? normalizedResult(selectedRun.conclusion || selectedRun.status)
      : required ? 'pending' : 'unknown',
    evidence: selectedRun ? runLink(selectedRun) : 'No matching main-branch release run was found.',
  };
  const build = stage(job, [/Build native project with warnings as errors/i], pending);
  const packageStage = stage(job, [/Package native release/i], pending);
  const publish = stage(job, [/Upload update assets to R2/i], pending);
  const rollout = stage(job, [/Trigger immediate update rollout/i], pending);
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
    stages: {
      workflow,
      build,
      package: packageStage,
      publish,
      rollout,
      artifact,
    },
  };
}

export async function collectNativeReleaseStatus(request) {
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
  return summarizeNativeRelease({
    mainCommit,
    currentRun,
    activeRun,
    run: selectedRun,
    jobs: Array.isArray(jobResponse?.jobs) ? jobResponse.jobs : [],
    artifacts: Array.isArray(artifactResponse?.artifacts) ? artifactResponse.artifacts : [],
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
      rollout: 'Device rollout step',
      artifact: 'Download artifact',
    };
    return `| ${labels[name] || name} | **${tableCell(value?.result)}** | ${tableCell(value?.evidence)} |`;
  });
  const selected = selectedRun
    ? `\`${shortSha(selectedRun.head_sha)}\` · ${runLink(selectedRun)} · ${completedAt(selectedRun)}`
    : 'none';

  return `<a id="homepanel-release-information" name="homepanel-release-information"></a>
#### HomePanel native release information

- **Generated:** ${generatedAt}
- **Current main:** ${mainLabel} — ${tableCell(release.main?.title)}
- **Native release required by current merge:** ${release.required ? 'yes' : 'no'}
- **Verdict:** **${tableCell(release.verdict)}**
- **Selected release run:** ${selected}
- **Active successful native release:** ${active}

| Stage | Result | Evidence |
|---|---|---|
${rows.join('\n')}`;
}
