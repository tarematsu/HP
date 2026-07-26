import { normalizeOutcome } from './observability-status-publisher.mjs';

const PRIORITY_ORDER = Object.freeze({ P0: 0, P1: 1, P2: 2, P3: 3 });

export const OBSERVABILITY_GATE_INFO = Object.freeze({
  daily: Object.freeze({
    label: 'Projected daily usage',
    priority: 'P2',
    detail: '#diagnostic-daily',
    action: 'Inspect the largest projected D1 and Queue meters, then reduce or defer the responsible operation.',
  }),
  freeTier: Object.freeze({
    label: 'Included-usage budget',
    priority: 'P2',
    detail: '#diagnostic-free-tier',
    action: 'Identify the included-usage meter over budget and confirm whether the projection needs load reduction.',
  }),
  contract: Object.freeze({
    label: 'Budget coverage contract',
    priority: 'P1',
    detail: '#diagnostic-contract',
    action: 'Restore missing gate coverage before treating the remaining green budget signals as complete.',
  }),
  d1Insights: Object.freeze({
    label: 'D1 query insights',
    priority: 'P2',
    detail: '#diagnostic-d1',
    action: 'Repair query-cost collection, then inspect the top rows-read and rows-written fingerprints.',
  }),
  query: Object.freeze({
    label: 'Cloudflare metrics and live diagnostics',
    priority: 'P1',
    detail: '#diagnostic-observability',
    action: 'Open the diagnostics section and workflow run to isolate the failing API, live-tail, or persisted-error query.',
  }),
  telemetry: Object.freeze({
    label: 'Current-deployment telemetry policy',
    priority: 'P1',
    detail: '#diagnostic-telemetry',
    action: 'Inspect current-deployment errors and CPU violations, then correlate them with the active Worker version.',
  }),
});

function compact(value, maximum = 180) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length <= maximum) return text;
  return `${text.slice(0, Math.max(0, maximum - 1))}…`;
}

function escapeCell(value) {
  return compact(value).replaceAll('|', '\\|');
}

function markdownRows(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('|') && line.endsWith('|'))
    .map((line) => line.slice(1, -1).split('|').map((cell) => compact(cell.replaceAll('`', ''))))
    .filter((cells) => cells.length > 1 && !cells.every((cell) => /^:?-{3,}:?$/.test(cell)));
}

export function extractViolationEvidence(text, { limit = 3 } = {}) {
  const rows = markdownRows(text);
  return rows
    .filter((cells) => cells.some((cell) => /^(?:violation|failure|failed|error|unhealthy|stale)$/i.test(cell)))
    .slice(0, limit)
    .map((cells) => {
      const statusIndex = cells.findIndex((cell) => /^(?:violation|failure|failed|error|unhealthy|stale)$/i.test(cell));
      const evidence = cells.slice(1, statusIndex < 0 ? Math.min(cells.length, 4) : statusIndex).slice(0, 3);
      return compact(`${cells[0]}${evidence.length ? ` — ${evidence.join(' / ')}` : ''}`, 220);
    });
}

function firstDiagnosticLine(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^#{1,6}\s/.test(line))
    .filter((line) => !/^<\/?details|^<summary>/i.test(line))
    .filter((line) => !/^\|?\s*:?-{3,}/.test(line));
  const actionable = lines.find((line) => /\b(?:violation|fail(?:ed|ure)?|error|unhealthy|stale|exceed(?:ed|s)?)\b/i.test(line));
  return compact(actionable || lines[0] || 'No diagnostic evidence was captured.', 220);
}

export function publicHealthSignal(summary) {
  const text = String(summary || '');
  if (!text.trim()) {
    return { state: 'unknown', evidence: 'No public endpoint snapshot was captured.' };
  }
  const failures = extractViolationEvidence(text, { limit: 2 });
  if (failures.length) return { state: 'failure', evidence: failures.join('; ') };
  if (/\b(?:HTTP\s+5\d\d|HTTP\s+4\d\d|timeout|connection refused|unhealthy)\b/i.test(text)) {
    return { state: 'failure', evidence: firstDiagnosticLine(text) };
  }
  if (/\b200\s+OK\b/i.test(text) || /\|\s*[^|\n]+\|\s*success\s*\|/i.test(text)) {
    return { state: 'healthy', evidence: 'Public health endpoint returned a successful response.' };
  }
  return { state: 'unknown', evidence: 'The public endpoint snapshot did not contain a definitive success or failure.' };
}

export function deploymentSignal(activeDeployments) {
  const entries = Object.entries(activeDeployments || {});
  if (!entries.length) return { state: 'unknown', evidence: 'No active deployment inventory was captured.' };

  const unavailable = entries.filter(([, deployment]) => {
    const status = String(deployment?.status || '').trim().toLowerCase();
    return status && status !== 'active';
  });
  if (unavailable.length) {
    return {
      state: 'failure',
      evidence: unavailable
        .map(([worker, deployment]) => `\`${worker}\` is ${String(deployment?.status || 'unavailable')}`)
        .join(', '),
    };
  }

  const incomplete = entries.filter(([, deployment]) => {
    const status = String(deployment?.status || '').trim().toLowerCase();
    const versions = Array.isArray(deployment?.version_ids) ? deployment.version_ids.filter(Boolean) : [];
    return status !== 'active' || !String(deployment?.deployment_id || '').trim() || !versions.length;
  });
  if (incomplete.length) {
    return {
      state: 'unknown',
      evidence: `${incomplete.map(([worker]) => `\`${worker}\``).join(', ')} has incomplete active-deployment metadata.`,
    };
  }

  return { state: 'healthy', evidence: `${entries.length}/${entries.length} monitored Workers are active.` };
}

function outcomeEvidence(key, outcome, summaries) {
  if (normalizeOutcome(outcome) === 'success') return 'No failure reported.';
  const summary = summaries?.[key] || '';
  if (key === 'daily' || key === 'freeTier') {
    const violations = extractViolationEvidence(summary);
    if (violations.length) return violations.join('; ');
  }
  return firstDiagnosticLine(summary);
}

function stateLabel(state) {
  switch (state) {
    case 'healthy':
    case 'success': return 'OK';
    case 'running': return 'RUNNING';
    case 'degraded': return 'WARN';
    case 'unknown': return 'UNKNOWN';
    default: return 'FAIL';
  }
}

function incidentLinks(detail, runUrl) {
  const links = [];
  if (detail) links.push(`[details](${detail})`);
  if (runUrl) links.push(`[workflow run](${runUrl})`);
  return links.join(' · ');
}

export function observabilityIssueOverall({ outcomes = {}, summaries = {}, activeDeployments = {} }) {
  const gatesHealthy = Object.keys(OBSERVABILITY_GATE_INFO)
    .every((key) => normalizeOutcome(outcomes[key]) === 'success');
  return gatesHealthy
    && publicHealthSignal(summaries.publicHealth).state === 'healthy'
    && deploymentSignal(activeDeployments).state === 'healthy'
    ? 'success'
    : 'failure';
}

export function buildObservabilityTriage({ outcomes = {}, summaries = {}, activeDeployments = {}, runUrl = '' }) {
  const publicHealth = publicHealthSignal(summaries.publicHealth);
  const deployments = deploymentSignal(activeDeployments);
  const incidents = [];

  if (publicHealth.state !== 'healthy') {
    incidents.push({
      priority: publicHealth.state === 'failure' ? 'P0' : 'P1',
      area: 'Public availability',
      evidence: publicHealth.evidence,
      action: 'Inspect the public health payload and active deployments before lower-priority budget findings.',
      detail: '#diagnostic-public-health',
    });
  }
  if (deployments.state !== 'healthy') {
    incidents.push({
      priority: deployments.state === 'failure' ? 'P0' : 'P1',
      area: 'Worker deployments',
      evidence: deployments.evidence,
      action: 'Verify traffic-bearing versions and redeploy or roll back any inactive Worker.',
      detail: '#deployment-context',
    });
  }

  for (const [key, info] of Object.entries(OBSERVABILITY_GATE_INFO)) {
    const outcome = normalizeOutcome(outcomes[key]);
    if (outcome === 'success') continue;
    incidents.push({
      priority: info.priority,
      area: info.label,
      evidence: outcomeEvidence(key, outcome, summaries),
      action: info.action,
      detail: info.detail,
    });
  }

  incidents.sort((left, right) => (
    (PRIORITY_ORDER[left.priority] ?? 99) - (PRIORITY_ORDER[right.priority] ?? 99)
    || left.area.localeCompare(right.area)
  ));

  const headline = incidents.length
    ? `> **ACTION REQUIRED — ${incidents.length} active signal${incidents.length === 1 ? '' : 's'}.** Highest priority: **${incidents[0].area}** — ${escapeCell(incidents[0].evidence)}`
    : '> **HEALTHY — no active observability incidents were detected.**';
  const incidentRows = incidents.length
    ? incidents.slice(0, 8).map((incident) => (
      `| **${incident.priority}** | ${escapeCell(incident.area)} | ${escapeCell(incident.evidence)} | ${escapeCell(incident.action)} | ${incidentLinks(incident.detail, runUrl)} |`
    )).join('\n')
    : '| - | No active incidents | All monitored gates and availability signals are healthy. | Continue routine monitoring. | - |';
  const omitted = incidents.length > 8 ? `\n\n_${incidents.length - 8} lower-priority signals omitted; open the gate matrix and detailed diagnostics below._` : '';

  const matrixRows = [
    ['Public endpoint', publicHealth.state, publicHealth.evidence],
    ['Worker deployments', deployments.state, deployments.evidence],
    ...Object.entries(OBSERVABILITY_GATE_INFO).map(([key, info]) => [
      info.label,
      normalizeOutcome(outcomes[key]),
      outcomeEvidence(key, outcomes[key], summaries),
    ]),
  ].map(([signal, state, evidence]) => `| ${escapeCell(signal)} | **${stateLabel(state)}** | ${escapeCell(evidence)} |`).join('\n');

  return `## Immediate triage

${headline}

| Priority | Area | Evidence | Next action | Drill-down |
|---|---|---|---|---|
${incidentRows}${omitted}

**Jump:** [runner health](#github-actions-runner-health) · [deployments](#deployment-context) · [daily budgets](#diagnostic-daily) · [D1 queries](#diagnostic-d1) · [telemetry](#diagnostic-telemetry)

<details>
<summary>Signal matrix</summary>

| Signal | State | Evidence |
|---|---|---|
${matrixRows}

</details>`;
}

export function diagnosticSectionTitle(title, state) {
  return `[${stateLabel(state)}] ${title}`;
}
